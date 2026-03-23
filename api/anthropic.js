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
    // Sanitize the request body to remove invalid Unicode surrogates
    let bodyStr = JSON.stringify(req.body);

    // Remove lone Unicode surrogates (the specific cause of Anthropic 400 errors)
    // These are characters in range \uD800-\uDFFF that appear without a pair
    bodyStr = bodyStr.replace(/\\uD[89AB][0-9A-Fa-f]{2}/g, '');

    // Also sanitize via a roundtrip through encodeURIComponent to catch bad chars
    bodyStr = bodyStr.replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''
    );

    // Remove any remaining lone surrogates using a more aggressive approach
    bodyStr = bodyStr.replace(/[\uD800-\uDFFF]/g, '');

    const cleanBody = JSON.parse(bodyStr);

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
