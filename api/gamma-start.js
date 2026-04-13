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

  const { prompt, title } = req.body || {};
  const apiKey = process.env.GAMMA_API_KEY || '';

  if (!apiKey) return res.status(500).json({ error: 'Gamma not configured — contact your administrator' });
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  // Fetch available themes to find a dark basic theme ID
  let darkThemeId = null;
  try {
    const tr = await fetch(`${GAMMA_BASE}/themes`, {
      headers: { 'X-API-KEY': apiKey },
    });
    const themesText = await tr.text();
    console.log('[Gamma start] themes status:', tr.status);
    console.log('[Gamma start] themes body:', themesText.slice(0, 1000));

    let themes = [];
    try {
      const parsed = JSON.parse(themesText);
      if (Array.isArray(parsed)) {
        themes = parsed;
      } else if (parsed && typeof parsed === 'object') {
        themes = parsed.themes || parsed.data || parsed.items || [];
      }
    } catch { /* ignore parse errors */ }

    // Log all theme IDs and names for debugging
    if (themes.length) {
      console.log('[Gamma start] available themes:', themes.map(t => `${t.id || t.themeId} — ${t.name}`).join(' | '));
    }

    // Find dark basic theme: prefer exact "dark basic" name, then dark, then basic, then first
    const darkTheme =
      themes.find(t => (t.name || '').toLowerCase() === 'dark basic') ||
      themes.find(t => (t.name || '').toLowerCase().includes('dark') && (t.name || '').toLowerCase().includes('basic')) ||
      themes.find(t => (t.name || '').toLowerCase().includes('dark')) ||
      themes.find(t => (t.name || '').toLowerCase().includes('midnight')) ||
      themes.find(t => (t.name || '').toLowerCase().includes('black')) ||
      themes.find(t => (t.type || '') === 'basic') ||
      themes[0];

    if (darkTheme) {
      darkThemeId = darkTheme.id || darkTheme.themeId;
      console.log('[Gamma start] selected theme:', darkThemeId, '—', darkTheme.name);
    } else {
      console.log('[Gamma start] no theme found in response');
    }
  } catch (themeErr) {
    console.warn('[Gamma start] theme fetch failed (non-fatal):', themeErr.message);
  }

  const payload = {
    inputText: prompt,
    textMode: 'generate',
    format: 'presentation',
    numCards: 10,
    textOptions: { language: 'en' },
    additionalInstructions: title
      ? 'Title: ' + title + '. Create a professional B2B sales presentation with a dark, minimal design.'
      : 'Create a professional B2B sales presentation with a dark, minimal design.',
    cardOptions: { dimensions: '16x9' },
  };

  // Inject theme ID if found
  if (darkThemeId) {
    payload.themeId = darkThemeId;
  }

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
      // If themeId caused a validation error, retry without it
      if (darkThemeId && (text.includes('themeId') || text.includes('theme'))) {
        console.warn('[Gamma start] themeId rejected, retrying without it...');
        delete payload.themeId;
        const r2 = await fetch(`${GAMMA_BASE}/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          body: JSON.stringify(payload),
        });
        const text2 = await r2.text();
        console.log('[Gamma start] retry status:', r2.status, '| body:', text2.slice(0, 500));
        let data2;
        try { data2 = JSON.parse(text2); } catch { data2 = { error: text2 }; }
        if (!r2.ok) {
          const errMsg2 = data2?.message || data2?.error?.message || data2?.error || text2.slice(0, 200);
          return res.status(r2.status).json({ error: errMsg2, gamma_status: r2.status, gamma_body: text2.slice(0, 300) });
        }
        const generationId2 = data2.generationId || data2.id;
        return res.status(200).json({ generationId: generationId2, status: data2.status, themeId: null, raw: data2 });
      }
      return res.status(r.status).json({ error: errMsg, gamma_status: r.status, gamma_body: text.slice(0, 300) });
    }

    const generationId = data.generationId || data.id;
    return res.status(200).json({ generationId, status: data.status, themeId: darkThemeId, raw: data });
  } catch (err) {
    console.error('[Gamma start] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
