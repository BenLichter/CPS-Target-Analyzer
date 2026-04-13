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

  try {
    // Deep-clean the body: strip bad Unicode AND replace non-Latin-1 chars
    function cleanValue(v) {
      if (typeof v === 'string') {
        let out = '';
        for (let i = 0; i < v.length; i++) {
          const code = v.charCodeAt(i);
          // Skip lone surrogates (D800-DFFF)
          if (code >= 0xD800 && code <= 0xDFFF) continue;
          // Skip control chars except tab, newline, carriage return
          if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) continue;
          // Replace common typographic chars that break Latin-1 encoding
          if (code === 0x2014 || code === 0x2013) { out += '-'; continue; }   // em/en dash → -
          if (code === 0x2018 || code === 0x2019) { out += "'"; continue; }   // curly single quotes → '
          if (code === 0x201C || code === 0x201D) { out += '"'; continue; }   // curly double quotes → "
          if (code === 0x2026) { out += '...'; continue; }                    // ellipsis → ...
          if (code === 0x00A0) { out += ' '; continue; }                      // non-breaking space → space
          if (code === 0x2022) { out += '*'; continue; }                      // bullet → *
          if (code === 0x00B7) { out += '*'; continue; }                      // middle dot → *
          if (code === 0x2192) { out += '->'; continue; }                     // → arrow
          if (code === 0x00D7) { out += 'x'; continue; }                      // × multiply sign → x
          // Drop any remaining non-Latin-1 characters (code > 255)
          if (code > 255) continue;
          out += v[i];
        }
        return out;
      }
      if (Array.isArray(v)) return v.map(cleanValue);
      if (v && typeof v === 'object') {
        const result = {};
        for (const [k, val] of Object.entries(v)) {
          result[cleanValue(k)] = cleanValue(val);
        }
        return result;
      }
      return v;
    }

    const body = cleanValue(req.body);
    const { model, max_tokens, system, messages } = body;

    // Use server env var only — key never comes from client
    const apiKey = process.env.XAI_API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({ error: 'Grok not configured — contact your administrator' });
    }

    // Build messages — prepend system as a system-role message if provided
    const allMessages = system
      ? [{ role: 'system', content: system }, ...(messages || [])]
      : (messages || []);

    const payload = {
      model: model || 'grok-3',
      messages: allMessages,
      max_tokens: max_tokens || 8000,
    };

    console.log('[Grok proxy] Calling xAI model:', payload.model, '| key prefix:', apiKey.slice(0, 8) + '...');

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log('[Grok proxy] xAI status:', response.status);
    console.log('[Grok proxy] xAI headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
    console.log('[Grok proxy] xAI body (first 500):', responseText.slice(0, 500));

    let data;
    try { data = JSON.parse(responseText); } catch { data = { error: responseText }; }

    if (!response.ok) {
      const errMsg = data?.error?.message || data?.error || responseText.slice(0, 200);
      console.error('[Grok proxy] xAI error', response.status, ':', errMsg);
      // Pass status + message back so frontend can show human-readable reason
      return res.status(response.status).json({
        error: errMsg,
        xai_status: response.status,
        xai_status_text: response.statusText,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[Grok proxy] Fetch error:', error.message);
    return res.status(500).json({ error: error.message, xai_status: 500 });
  }
}
