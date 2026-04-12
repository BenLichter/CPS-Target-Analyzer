const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';

async function pollGeneration(generationId, apiKey, maxAttempts = 12, intervalMs = 4000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const r = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
      headers: { 'X-API-KEY': apiKey },
    });
    const data = await r.json();
    console.log(`[Gamma proxy] poll ${i + 1}/${maxAttempts} status:`, data.status);
    if (data.status === 'completed') return { ok: true, data };
    if (data.status === 'failed') return { ok: false, data, error: data.error || 'Generation failed' };
  }
  return { ok: false, error: 'Generation timed out after ' + (maxAttempts * intervalMs / 1000) + 's' };
}

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
    const payload = {
      inputText: prompt,
      format: 'presentation',
      numCards: 10,
      additionalInstructions: title ? 'Title: ' + title : undefined,
    };

    console.log('[Gamma proxy] Submitting generation | key prefix:', apiKey.slice(0, 10) + '...');

    const response = await fetch(`${GAMMA_BASE}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log('[Gamma proxy] submit status:', response.status);
    console.log('[Gamma proxy] submit body:', responseText.slice(0, 500));

    let data;
    try { data = JSON.parse(responseText); } catch { data = { error: responseText }; }

    if (!response.ok) {
      const errMsg = data?.message || data?.error?.message || data?.error || responseText.slice(0, 200);
      console.error('[Gamma proxy] submit error', response.status, ':', errMsg);
      return res.status(response.status).json({
        error: errMsg,
        gamma_status: response.status,
        gamma_status_text: response.statusText,
      });
    }

    const generationId = data.generationId || data.id;

    // If already completed (sync response), return immediately
    if (data.status === 'completed' && (data.gammaUrl || data.url)) {
      return res.status(200).json({ url: data.gammaUrl || data.url, generationId, data });
    }

    if (!generationId) {
      return res.status(200).json({ url: data.gammaUrl || data.url || null, data });
    }

    // Poll until completed
    console.log('[Gamma proxy] polling generationId:', generationId);
    const poll = await pollGeneration(generationId, apiKey);

    if (!poll.ok) {
      return res.status(500).json({ error: poll.error, generationId, data: poll.data });
    }

    const url = poll.data.gammaUrl || poll.data.url;
    return res.status(200).json({ url, generationId, data: poll.data });

  } catch (error) {
    console.error('[Gamma proxy] fetch error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
