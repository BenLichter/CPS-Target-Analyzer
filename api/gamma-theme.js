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

  const { generationId, key } = req.body || {};
  const apiKey = key || process.env.GAMMA_API_KEY || '';

  if (!generationId) return res.status(400).json({ error: 'No generationId provided' });
  if (!apiKey) return res.status(400).json({ error: 'No Gamma API key provided' });

  try {
    // Fetch available themes to find a dark one
    const tr = await fetch(`${GAMMA_BASE}/themes`, {
      headers: { 'X-API-KEY': apiKey },
    });

    let themesRaw;
    try { themesRaw = await tr.json(); } catch { themesRaw = null; }

    console.log('[Gamma theme] themes response status:', tr.status, '| data:', JSON.stringify(themesRaw || '').slice(0, 500));

    // Normalize to array
    let themes = [];
    if (Array.isArray(themesRaw)) {
      themes = themesRaw;
    } else if (themesRaw && typeof themesRaw === 'object') {
      themes = themesRaw.themes || themesRaw.data || themesRaw.items || [];
    }

    // Find a dark theme by name, fall back to first available
    const darkTheme = themes.find(t =>
      (t.name || '').toLowerCase().includes('dark') ||
      (t.name || '').toLowerCase().includes('midnight') ||
      (t.name || '').toLowerCase().includes('black') ||
      (t.name || '').toLowerCase().includes('noir')
    ) || themes.find(t => (t.type || '') === 'basic') || themes[0];

    const darkThemeId = darkTheme ? (darkTheme.id || darkTheme.themeId) : null;

    if (!darkThemeId) {
      console.log('[Gamma theme] no dark theme found, available:', themes.map(t => t.name).join(', '));
      return res.status(200).json({ ok: false, message: 'No dark theme found', themes: themesRaw });
    }

    console.log('[Gamma theme] applying themeId:', darkThemeId, '(', darkTheme.name, ') to generation:', generationId);

    // Apply theme via PUT
    const r = await fetch(`${GAMMA_BASE}/generations/${encodeURIComponent(generationId)}/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ themeId: darkThemeId }),
    });

    const text = await r.text();
    console.log('[Gamma theme] PUT status:', r.status, '| body:', text.slice(0, 300));

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return res.status(200).json({ ok: r.ok, status: r.status, themeId: darkThemeId, themeName: darkTheme.name, data });

  } catch (err) {
    console.error('[Gamma theme] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
