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

async function kvDel(url, token, key) {
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['DEL', key]])
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  if (req.method === 'GET') {
    try {
      const conversations = (await kvGet(kvUrl, kvToken, 'collateral:conversations')) || [];
      return res.status(200).json({ conversations });
    } catch (error) {
      console.error('[collateral/conversations GET]', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const conversations = (await kvGet(kvUrl, kvToken, 'collateral:conversations')) || [];
      await Promise.all(conversations.map(function(c) {
        return kvDel(kvUrl, kvToken, 'collateral:conversation:' + c.id);
      }));
      await kvSet(kvUrl, kvToken, 'collateral:conversations', []);
      return res.status(200).json({ ok: true, count: conversations.length });
    } catch (error) {
      console.error('[collateral/conversations DELETE]', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
