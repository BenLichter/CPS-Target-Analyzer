let memoryStore = null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      // Use Upstash Redis REST API directly — no SDK needed
      if (req.method === 'GET') {
        const r = await fetch(`${url}/get/cp_pipeline`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await r.json();
        const pipeline = data.result ? JSON.parse(data.result) : [];
        return res.status(200).json({ pipeline });
      }

      if (req.method === 'POST') {
        const { pipeline } = req.body;
        await fetch(`${url}/set/cp_pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: JSON.stringify(pipeline) })
        });
        return res.status(200).json({ ok: true });
      }
    }

    // Fallback: in-memory (single session only)
    if (req.method === 'GET') return res.status(200).json({ pipeline: memoryStore || [] });
    if (req.method === 'POST') { memoryStore = req.body.pipeline; return res.status(200).json({ ok: true }); }

  } catch (error) {
    console.error('[Pipeline]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
