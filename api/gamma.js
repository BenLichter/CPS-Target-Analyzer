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

  if (!apiKey) {
    return res.status(400).json({ error: 'No Gamma API key provided' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  try {
    const payload = { prompt, title: title || prompt.slice(0, 80) };

    console.log('[Gamma proxy] Generating presentation | key prefix:', apiKey.slice(0, 10) + '...');

    const response = await fetch('https://api.gamma.app/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log('[Gamma proxy] status:', response.status);
    console.log('[Gamma proxy] body (first 500):', responseText.slice(0, 500));

    let data;
    try { data = JSON.parse(responseText); } catch { data = { error: responseText }; }

    if (!response.ok) {
      const errMsg = data?.error?.message || data?.error || responseText.slice(0, 200);
      console.error('[Gamma proxy] error', response.status, ':', errMsg);
      return res.status(response.status).json({
        error: errMsg,
        gamma_status: response.status,
        gamma_status_text: response.statusText,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[Gamma proxy] fetch error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
