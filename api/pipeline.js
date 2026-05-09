let memoryStore = { pipeline: [], keys: null, analyses: {} };

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  // Upstash REST API: POST /pipeline with array of commands
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      if (req.method === 'GET') {
        const analysisId = req.query && req.query.analysis;
        if (analysisId) {
          const analysisData = await kvGet(url, token, 'cp_analysis_' + analysisId);
          return res.status(200).json({ analysisData: analysisData || null });
        }

        const [pipeline, keys] = await Promise.all([
          kvGet(url, token, 'cp_pipeline'),
          kvGet(url, token, 'cp_keys'),
        ]);

        // Fetch persisted analyses for deals that have analysisUpdatedAt, newest first, up to 20
        const analyses = {};
        if (Array.isArray(pipeline)) {
          const dealsWithAnalysis = pipeline
            .filter(function(d) { return d && d.analysisUpdatedAt && d.id; })
            .sort(function(a, b) { return new Date(b.analysisUpdatedAt) - new Date(a.analysisUpdatedAt); })
            .slice(0, 20);
          if (dealsWithAnalysis.length > 0) {
            const results = await Promise.all(
              dealsWithAnalysis.map(function(d) { return kvGet(url, token, 'cp_analysis_' + d.id); })
            );
            dealsWithAnalysis.forEach(function(d, i) {
              if (results[i]) analyses[d.id] = results[i];
            });
          }
        }

        return res.status(200).json({
          pipeline: Array.isArray(pipeline) ? pipeline : [],
          keys: keys || null,
          analyses
        });
      }

      if (req.method === 'POST') {
        const { pipeline, keys, analysisId, analysisData } = req.body;
        const ops = [];
        if (pipeline !== undefined) ops.push(kvSet(url, token, 'cp_pipeline', pipeline));
        if (keys !== undefined) ops.push(kvSet(url, token, 'cp_keys', keys));
        if (analysisId !== undefined && analysisData !== undefined) {
          ops.push(kvSet(url, token, 'cp_analysis_' + analysisId, analysisData));
        }
        await Promise.all(ops);
        return res.status(200).json({ ok: true });
      }
    }

    // Fallback: in-memory
    if (req.method === 'GET') {
      const analysisId = req.query && req.query.analysis;
      if (analysisId) {
        return res.status(200).json({ analysisData: (memoryStore.analyses && memoryStore.analyses[analysisId]) || null });
      }
      return res.status(200).json({
        pipeline: memoryStore.pipeline,
        keys: memoryStore.keys,
        analyses: memoryStore.analyses || {}
      });
    }
    if (req.method === 'POST') {
      const { pipeline, keys, analysisId, analysisData } = req.body;
      if (pipeline !== undefined) memoryStore.pipeline = pipeline;
      if (keys !== undefined) memoryStore.keys = keys;
      if (analysisId !== undefined && analysisData !== undefined) {
        if (!memoryStore.analyses) memoryStore.analyses = {};
        memoryStore.analyses[analysisId] = analysisData;
      }
      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('[Pipeline]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
