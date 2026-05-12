import { put } from '@vercel/blob';
import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';
import { Index } from '@upstash/vector';

export const config = { api: { bodyParser: false } };
export const maxDuration = 300;

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

  return buffer.toString('utf8');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var kvUrl = process.env.KV_REST_API_URL;
  var kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured', step: 'init' });
  if (!process.env.UPSTASH_VECTOR_REST_URL) return res.status(500).json({ error: 'Vector not configured', step: 'init' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Blob token not configured', step: 'init' });

  var step = 'init';
  try {
    // ── Step 1: Parse multipart form ─────────────────────────────────────────
    step = 'parse';
    console.log('Parsing form...');
    var form = new IncomingForm({ maxFileSize: 50 * 1024 * 1024, keepExtensions: true });
    var parsed = await new Promise(function(resolve, reject) {
      form.parse(req, function(err, fields, files) {
        if (err) return reject(err);
        resolve({ fields: fields, files: files });
      });
    });

    var uploadedFile = parsed.files.file;
    if (Array.isArray(uploadedFile)) uploadedFile = uploadedFile[0];
    if (!uploadedFile) return res.status(400).json({ error: 'No file uploaded', step: step });

    var filename = uploadedFile.originalFilename || uploadedFile.newFilename || 'upload';
    var size = uploadedFile.size;
    console.log('File received: ' + filename + ', ' + size + ' bytes');

    // ── Step 2: Read file buffer ──────────────────────────────────────────────
    step = 'read';
    var buffer = readFileSync(uploadedFile.filepath);

    // ── Step 3: Upload to Vercel Blob ─────────────────────────────────────────
    step = 'blob';
    var blob = await put(filename, buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    });
    console.log('Uploaded to blob: ' + blob.url);

    // ── Step 4: Extract text ──────────────────────────────────────────────────
    step = 'extract';
    var text = await extractText(buffer, filename);
    console.log('Extracted ' + text.length + ' chars from ' + filename);
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text could be extracted from this file', step: step });

    // ── Step 5: Chunk ─────────────────────────────────────────────────────────
    step = 'chunk';
    var chunks = chunkText(text.trim());
    console.log('Chunked into ' + chunks.length + ' segments');

    // ── Step 6: Upsert to Upstash Vector ──────────────────────────────────────
    step = 'vector';
    var docId = crypto.randomUUID();
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
          metadata: { docId: docId, filename: filename, chunkIndex: j, text: chunks[j], totalChunks: chunks.length },
        });
      }
      await index.upsert(batch);
    }
    console.log('Upserted vectors for ' + docId);

    // ── Step 7: Save metadata to Redis ────────────────────────────────────────
    step = 'redis';
    var existingDocs = (await kvGet(kvUrl, kvToken, 'collateral:docs')) || [];
    var newDoc = {
      id: docId,
      filename: filename,
      type: filename.split('.').pop(),
      size: size,
      uploadedAt: new Date().toISOString(),
      blobUrl: blob.url,
      chunkCount: chunks.length,
    };
    existingDocs.unshift(newDoc);
    await kvSet(kvUrl, kvToken, 'collateral:docs', existingDocs);
    console.log('Saved to redis: ' + docId);

    return res.status(200).json({ ok: true, docId: docId, chunkCount: chunks.length });
  } catch (error) {
    console.error('[collateral/process] step=' + step, error.message, error.stack);
    return res.status(500).json({ error: error.message, stack: error.stack, step: step });
  }
}
