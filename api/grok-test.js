import { verifyAuth } from './_lib/auth.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = (req.body && req.body.key) || req.query.key || process.env.XAI_API_KEY || '';

  if (!key) {
    return res.status(400).json({ ok: false, error: 'No xAI API key provided — pass { key } in body or ?key= in query' });
  }

  const payload = {
    model: 'grok-3-fast',
    messages: [{ role: 'user', content: 'Reply with exactly the word PONG and nothing else.' }],
    max_tokens: 10,
  };

  let xaiStatus, xaiStatusText, xaiHeaders, xaiBody, xaiData;
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify(payload),
    });

    xaiStatus = response.status;
    xaiStatusText = response.statusText;
    xaiHeaders = Object.fromEntries(response.headers.entries());
    xaiBody = await response.text();

    try { xaiData = JSON.parse(xaiBody); } catch { xaiData = null; }

    const ok = response.ok && xaiData && xaiData.choices && xaiData.choices.length > 0;
    const reply = ok ? (xaiData.choices[0].message?.content || '') : null;

    return res.status(200).json({
      ok,
      reply,
      xai_status: xaiStatus,
      xai_status_text: xaiStatusText,
      xai_error: ok ? null : (xaiData?.error?.message || xaiData?.error || xaiBody.slice(0, 300)),
      xai_headers: xaiHeaders,
      key_prefix: key.slice(0, 10) + '...',
      model: payload.model,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      xai_status: null,
      xai_error: 'Fetch failed: ' + err.message,
      key_prefix: key.slice(0, 10) + '...',
    });
  }
}
