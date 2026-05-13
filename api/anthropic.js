import { verifyAuth } from './_lib/auth.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Deep-clean the body: walk every string value and strip bad Unicode
    function cleanValue(v) {
      if (typeof v === 'string') {
        // Replace lone surrogates and control chars char by char
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

    const cleanBody = cleanValue(req.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(cleanBody),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('[Anthropic proxy] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
