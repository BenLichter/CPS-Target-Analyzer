// Pipeline persistence using Vercel's built-in KV store
// Falls back to a simple in-memory store if KV is not configured
let memoryStore = null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Try Vercel KV if available
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { kv } = await import('@vercel/kv');

      if (req.method === 'GET') {
        const pipeline = await kv.get('cp_pipeline') || [];
        return res.status(200).json({ pipeline });
      }

      if (req.method === 'POST') {
        const { pipeline } = req.body;
        await kv.set('cp_pipeline', pipeline);
        return res.status(200).json({ ok: true });
      }
    }

    // Fallback: use in-memory store (resets on redeploy, but works without KV setup)
    if (req.method === 'GET') {
      return res.status(200).json({ pipeline: memoryStore || [] });
    }

    if (req.method === 'POST') {
      const { pipeline } = req.body;
      memoryStore = pipeline;
      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('[Pipeline API] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
