async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const convId = req.query && req.query.id;
  if (!convId) return res.status(400).json({ error: 'Missing id' });

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  try {
    const conversation = await kvGet(kvUrl, kvToken, 'collateral:conversation:' + convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    return res.status(200).json({ conversation });
  } catch (error) {
    console.error('[collateral/conversation]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
