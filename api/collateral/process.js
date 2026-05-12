import { Index } from '@upstash/vector';

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
}

function chunkText(text, chunkSize, overlap) {
  chunkSize = chunkSize || 500;
  overlap = overlap || 50;
  var words = text.split(/\s+/).filter(Boolean);
  var chunks = [];
  var i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
    i += chunkSize - overlap;
  }
  return chunks.filter(function(c) { return c.trim().length > 0; });
}

async function extractText(buffer, filename) {
  var ext = (filename.split('.').pop() || '').toLowerCase();

  if (ext === 'pdf') {
    // Import from lib path to avoid pdf-parse test-file loading issue
    var pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    var pdfData = await pdfParse(buffer);
    return pdfData.text || '';
  }

  if (ext === 'docx') {
    var mammoth = (await import('mammoth')).default;
    var result = await mammoth.extractRawText({ buffer: buffer });
    return result.value || '';
  }

  if (ext === 'pptx') {
    var unzipper = (await import('unzipper')).default;
    var directory = await unzipper.Open.buffer(buffer);
    var texts = [];
    for (var i = 0; i < directory.files.length; i++) {
      var file = directory.files[i];
      if (/^ppt\/slides\/slide\d+\.xml$/.test(file.path)) {
        var content = await file.buffer();
        var xml = content.toString('utf8');
        var matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
        var slideText = matches.map(function(m) { return m.replace(/<[^>]+>/g, ''); }).join(' ');
        if (slideText.trim()) texts.push(slideText);
      }
    }
    return texts.join('\n\n');
  }

  if (ext === 'xlsx' || ext === 'xls') {
    var XLSX = (await import('xlsx')).default;
    var workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map(function(name) {
      return 'Sheet: ' + name + '\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    }).join('\n\n');
  }

  if (ext === 'csv') {
    var Papa = (await import('papaparse')).default;
    var parsed = Papa.parse(buffer.toString('utf8'), { header: true, skipEmptyLines: true });
    return parsed.data.map(function(row) { return Object.values(row).join(', '); }).join('\n');
  }

  // txt, md, and all other text formats
  return buffer.toString('utf8');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var blobUrl = body.blobUrl;
  var filename = body.filename;
  var size = body.size;
  var type = body.type;
  if (!blobUrl || !filename) return res.status(400).json({ error: 'Missing blobUrl or filename' });

  var kvUrl = process.env.KV_REST_API_URL;
  var kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });
  if (!process.env.UPSTASH_VECTOR_REST_URL) return res.status(500).json({ error: 'Vector not configured' });

  try {
    // Fetch file from Vercel Blob
    var fileRes = await fetch(blobUrl);
    if (!fileRes.ok) return res.status(500).json({ error: 'Failed to fetch blob: ' + fileRes.status });
    var arrayBuf = await fileRes.arrayBuffer();
    var buffer = Buffer.from(arrayBuf);

    // Extract text
    var text = await extractText(buffer, filename);
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text could be extracted from this file' });

    // Chunk into ~500-word segments with 50-word overlap
    var chunks = chunkText(text.trim());

    // Generate a unique docId
    var docId = crypto.randomUUID();

    // Upsert chunks into Upstash Vector (built-in embedding — pass data: text)
    var index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });

    var batchSize = 10;
    for (var b = 0; b < chunks.length; b += batchSize) {
      var batch = [];
      for (var j = b; j < Math.min(b + batchSize, chunks.length); j++) {
        batch.push({
          id: docId + ':' + j,
          data: chunks[j],
          metadata: {
            docId: docId,
            filename: filename,
            chunkIndex: j,
            text: chunks[j],
            totalChunks: chunks.length,
          },
        });
      }
      await index.upsert(batch);
    }

    // Save doc metadata to Redis
    var existingDocs = (await kvGet(kvUrl, kvToken, 'collateral:docs')) || [];
    var newDoc = {
      id: docId,
      filename: filename,
      type: type || filename.split('.').pop(),
      size: size || buffer.length,
      uploadedAt: new Date().toISOString(),
      blobUrl: blobUrl,
      chunkCount: chunks.length,
    };
    existingDocs.unshift(newDoc);
    await kvSet(kvUrl, kvToken, 'collateral:docs', existingDocs);

    return res.status(200).json({ ok: true, docId: docId, chunkCount: chunks.length });
  } catch (error) {
    console.error('[collateral/process]', error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
