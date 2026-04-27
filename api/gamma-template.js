let memTemplateId = null;

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_KEY = 'cp_gamma_master_template_id';
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    if (url && token) {
      if (req.method === 'GET') {
        const templateId = await kvGet(url, token, REDIS_KEY);
        return res.status(200).json({ templateId: templateId || null });
      }
      if (req.method === 'POST') {
        const { templateId } = req.body || {};
        if (!templateId) return res.status(400).json({ error: 'No templateId provided' });
        await kvSet(url, token, REDIS_KEY, templateId);
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'DELETE') {
        await kvSet(url, token, REDIS_KEY, null);
        return res.status(200).json({ ok: true });
      }
    }

    // In-memory fallback
    if (req.method === 'GET') {
      return res.status(200).json({ templateId: memTemplateId });
    }
    if (req.method === 'POST') {
      const { templateId } = req.body || {};
      if (!templateId) return res.status(400).json({ error: 'No templateId provided' });
      memTemplateId = templateId;
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      memTemplateId = null;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[gamma-template]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
