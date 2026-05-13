import { verifyAuth } from './_lib/auth.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(200).json({
      ok: false,
      error: 'Redis not configured',
      kvUrl: kvUrl ? 'set' : 'MISSING',
      kvToken: kvToken ? 'set' : 'MISSING',
    });
  }

  try {
    const r = await fetch(`${kvUrl}/get/cp_gamma_master_template_id`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const raw = await r.text();
    console.log('[gamma-template-check] Redis GET status:', r.status, '| body:', raw.slice(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch { data = { error: raw }; }

    let templateValue = null;
    if (data.result) {
      try { templateValue = JSON.parse(data.result); } catch { templateValue = data.result; }
    }

    const templateId = typeof templateValue === 'string' ? templateValue
      : (templateValue && templateValue.templateId) || null;
    const templateUrl = templateValue && typeof templateValue === 'object'
      ? (templateValue.templateUrl || null) : null;
    // gammaId: from URL for new-format saves; legacy string saves ARE the gammaId
    const gammaId = templateUrl
      ? templateUrl.split('/').filter(Boolean).pop()
      : templateId;

    return res.status(200).json({
      ok: true,
      redis_status: r.status,
      result_raw: data.result || null,
      templateValue,
      templateId,
      templateUrl,
      gammaId,
      kvUrl_prefix: kvUrl.slice(0, 35) + '...',
      note: gammaId
        ? ('Template ready — gammaId: ' + gammaId + (templateUrl ? ' (extracted from URL)' : ' (stored directly)'))
        : 'No template saved — run Build Master Template first',
    });
  } catch (err) {
    console.error('[gamma-template-check] error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
