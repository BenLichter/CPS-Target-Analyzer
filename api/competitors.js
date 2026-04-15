let memoryCompetitors = [];

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${key}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    if (url && token) {
      if (req.method === 'GET') {
        const data = await kvGet(url, token, 'cp_competitors');
        return res.status(200).json({ competitors: Array.isArray(data) ? data : [] });
      }
      if (req.method === 'POST') {
        const { competitors } = req.body || {};
        if (!Array.isArray(competitors)) return res.status(400).json({ error: 'competitors must be array' });
        await kvSet(url, token, 'cp_competitors', competitors);
        return res.status(200).json({ ok: true });
      }
    }
    // Fallback: in-memory
    if (req.method === 'GET') return res.status(200).json({ competitors: memoryCompetitors });
    if (req.method === 'POST') {
      const { competitors } = req.body || {};
      if (Array.isArray(competitors)) memoryCompetitors = competitors;
      return res.status(200).json({ ok: true });
    }
  } catch (error) {
    console.error('[Competitors]', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
