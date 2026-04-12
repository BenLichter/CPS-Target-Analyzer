const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = (req.body && req.body.key) || req.query.key || process.env.GAMMA_API_KEY || '';

  if (!key) {
    return res.status(400).json({ ok: false, error: 'No Gamma API key — pass { key } in body or ?key= in query' });
  }

  let submitStatus, submitBody, submitData;

  try {
    const payload = {
      inputText: 'Create a 3-slide test presentation about CoinPayments crypto payment infrastructure.',
      format: 'presentation',
      numCards: 3,
    };

    console.log('[Gamma test] Submitting | key prefix:', key.slice(0, 10) + '...');

    const r = await fetch(`${GAMMA_BASE}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': key,
      },
      body: JSON.stringify(payload),
    });

    submitStatus = r.status;
    submitBody = await r.text();
    try { submitData = JSON.parse(submitBody); } catch { submitData = null; }

    console.log('[Gamma test] submit status:', submitStatus);
    console.log('[Gamma test] submit body:', submitBody.slice(0, 500));

    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        submit_status: submitStatus,
        submit_error: submitData?.message || submitData?.error || submitBody.slice(0, 300),
        submit_raw: submitBody.slice(0, 500),
        key_prefix: key.slice(0, 10) + '...',
      });
    }

    const generationId = submitData?.generationId || submitData?.id;

    // Poll up to 3 times to verify the generation kicks off
    let pollResult = null;
    if (generationId) {
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        const pr = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
          headers: { 'X-API-KEY': key },
        });
        const pd = await pr.json();
        console.log('[Gamma test] poll', i + 1, 'status:', pd.status);
        pollResult = pd;
        if (pd.status === 'completed' || pd.status === 'failed') break;
      }
    }

    return res.status(200).json({
      ok: true,
      submit_status: submitStatus,
      generationId,
      generation_status: pollResult?.status || submitData?.status,
      gammaUrl: pollResult?.gammaUrl || submitData?.gammaUrl || null,
      credits_remaining: pollResult?.credits?.remaining || submitData?.credits?.remaining || null,
      submit_raw: submitData,
      poll_raw: pollResult,
      key_prefix: key.slice(0, 10) + '...',
    });

  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: 'Fetch failed: ' + err.message,
      submit_status: submitStatus || null,
      submit_raw: submitBody ? submitBody.slice(0, 300) : null,
      key_prefix: key.slice(0, 10) + '...',
    });
  }
}
