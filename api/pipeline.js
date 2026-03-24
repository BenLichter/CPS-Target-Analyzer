let memoryStore = { pipeline: [], keys: null };

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  // Upstash REST API: POST /pipeline with array of commands
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      if (req.method === 'GET') {
        const [pipeline, keys] = await Promise.all([
          kvGet(url, token, 'cp_pipeline'),
          kvGet(url, token, 'cp_keys'),
        ]);
        return res.status(200).json({
          pipeline: Array.isArray(pipeline) ? pipeline : [],
          keys: keys || null
        });
      }

      if (req.method === 'POST') {
        const { pipeline, keys } = req.body;
        const ops = [];
        if (pipeline !== undefined) ops.push(kvSet(url, token, 'cp_pipeline', pipeline));
        if (keys !== undefined) ops.push(kvSet(url, token, 'cp_keys', keys));
        await Promise.all(ops);
        return res.status(200).json({ ok: true });
      }
    }

    // Fallback: in-memory
    if (req.method === 'GET') {
      return res.status(200).json(memoryStore);
    }
    if (req.method === 'POST') {
      const { pipeline, keys } = req.body;
      if (pipeline !== undefined) memoryStore.pipeline = pipeline;
      if (keys !== undefined) memoryStore.keys = keys;
      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('[Pipeline]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
