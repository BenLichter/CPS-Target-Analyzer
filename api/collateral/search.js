import { verifyAuth } from '../_lib/auth.js';
import { Index } from '@upstash/vector';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, topK = 10 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });

    const results = await index.query({
      data: query,
      topK,
      includeMetadata: true,
    });

    return res.status(200).json({
      results: results.map(function(r) {
        return {
          id: r.id,
          score: r.score,
          text: (r.metadata && r.metadata.text) || '',
          filename: (r.metadata && r.metadata.filename) || '',
          docId: (r.metadata && r.metadata.docId) || '',
          chunkIndex: (r.metadata && r.metadata.chunkIndex != null) ? r.metadata.chunkIndex : 0,
        };
      }),
    });
  } catch (error) {
    console.error('[collateral/search]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
