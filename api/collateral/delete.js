import { verifyAuth } from '../_lib/auth.js';
import { del } from '@vercel/blob';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const docId = req.query && req.query.id;
  if (!docId) return res.status(400).json({ error: 'Missing id' });

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  try {
    const docs = (await kvGet(kvUrl, kvToken, 'collateral:docs')) || [];
    const doc = docs.find(function(d) { return d.id === docId; });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Delete chunks from Upstash Vector
    const index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });
    if (doc.chunkCount > 0) {
      var ids = [];
      for (var i = 0; i < doc.chunkCount; i++) ids.push(docId + ':' + i);
      await index.delete(ids);
    }

    // Delete from Vercel Blob
    if (doc.blobUrl) {
      await del(doc.blobUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    }

    // Remove from Redis
    await kvSet(kvUrl, kvToken, 'collateral:docs', docs.filter(function(d) { return d.id !== docId; }));

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[collateral/delete]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
