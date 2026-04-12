const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const id  = req.query.id  || (req.body && req.body.id);
  const key = req.query.key || (req.body && req.body.key) || process.env.GAMMA_API_KEY || '';

  if (!id)  return res.status(400).json({ error: 'No generation id provided' });
  if (!key) return res.status(400).json({ error: 'No Gamma API key provided' });

  try {
    const r = await fetch(`${GAMMA_BASE}/generations/${encodeURIComponent(id)}`, {
      headers: { 'X-API-KEY': key },
    });

    const text = await r.text();
    console.log('[Gamma status] id:', id, '| status:', r.status, '| body:', text.slice(0, 300));

    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!r.ok) {
      const errMsg = data?.message || data?.error || text.slice(0, 200);
      return res.status(r.status).json({ error: errMsg });
    }

    return res.status(200).json({
      status: data.status,
      url: data.gammaUrl || data.url || null,
      generationId: id,
      error: data.error || null,
    });
  } catch (err) {
    console.error('[Gamma status] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
