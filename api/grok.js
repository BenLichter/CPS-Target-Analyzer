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
    // Deep-clean the body: walk every string value and strip bad Unicode
    function cleanValue(v) {
      if (typeof v === 'string') {
        let out = '';
        for (let i = 0; i < v.length; i++) {
          const code = v.charCodeAt(i);
          // Skip lone surrogates (D800-DFFF)
          if (code >= 0xD800 && code <= 0xDFFF) continue;
          // Skip control chars except tab, newline, carriage return
          if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) continue;
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
    const { model, max_tokens, system, messages, key } = body;

    // Use key from request body, fall back to server env var
    const apiKey = key || process.env.XAI_API_KEY || '';
    if (!apiKey) {
      return res.status(400).json({ error: 'No xAI API key provided' });
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

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('[Grok proxy] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
