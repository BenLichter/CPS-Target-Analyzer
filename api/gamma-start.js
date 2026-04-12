const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { prompt, title, key } = req.body || {};
  const apiKey = key || process.env.GAMMA_API_KEY || '';

  if (!apiKey) return res.status(400).json({ error: 'No Gamma API key provided' });
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const payload = {
    inputText: prompt,
    textMode: 'generate',
    format: 'presentation',
    numCards: 10,
    theme: 'midnight',
    textOptions: { language: 'en' },
    additionalInstructions: title
      ? 'Title: ' + title + '. Create a professional B2B sales presentation with a dark, minimal design.'
      : 'Create a professional B2B sales presentation with a dark, minimal design.',
    cardOptions: { dimensions: '16x9' },
  };

  console.log('[Gamma start] key prefix:', apiKey.slice(0, 10) + '...');
  console.log('[Gamma start] request body:', JSON.stringify(payload));

  try {
    const r = await fetch(`${GAMMA_BASE}/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    console.log('[Gamma start] response status:', r.status, '| body:', text.slice(0, 500));

    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!r.ok) {
      const errMsg = data?.message || data?.error?.message || data?.error || text.slice(0, 200);
      return res.status(r.status).json({ error: errMsg, gamma_status: r.status, gamma_body: text.slice(0, 300) });
    }

    const generationId = data.generationId || data.id;
    return res.status(200).json({ generationId, status: data.status, raw: data });
  } catch (err) {
    console.error('[Gamma start] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
