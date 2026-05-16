import { verifyAuth } from './_lib/auth.js';
let memoryStore = { pipeline: [], keys: null, analyses: {} };

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
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
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      if (req.method === 'GET') {
        let [pipeline, keys] = await Promise.all([
          kvGet(url, token, 'cp_pipeline'),
          kvGet(url, token, 'cp_keys'),
        ]);

        // One-time migration: priority values p1→tier_1, p2→tier_2
        if (Array.isArray(pipeline)) {
          const alreadyMigrated = await kvGet(url, token, 'cp_pipeline:tier_migrated');
          if (!alreadyMigrated) {
            var migrated = pipeline.map(function(d) {
              if (!d) return d;
              if (d.priority === 'p1') return Object.assign({}, d, { priority: 'tier_1' });
              if (d.priority === 'p2') return Object.assign({}, d, { priority: 'tier_2' });
              return d;
            });
            await Promise.all([
              kvSet(url, token, 'cp_pipeline', migrated),
              kvSet(url, token, 'cp_pipeline:tier_migrated', true),
            ]);
            pipeline = migrated;
          }
        }

        // Only fetch analyses for deals that have analysisUpdatedAt — this field is
        // now written atomically with the analysis save so it is a reliable indicator.
        // Cap at 30 most-recently-analysed to stay within Upstash free-tier limits.
        const analyses = {};
        if (Array.isArray(pipeline)) {
          const dealsWithAnalysis = pipeline
            .filter(function(d) { return d && d.id && d.analysisUpdatedAt; })
            .sort(function(a, b) { return new Date(b.analysisUpdatedAt) - new Date(a.analysisUpdatedAt); })
            .slice(0, 30);
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
        const { pipeline, keys, analysisId, analysisData, analyses } = req.body;
        const ops = [];
        if (pipeline !== undefined) ops.push(kvSet(url, token, 'cp_pipeline', pipeline));
        if (keys !== undefined) ops.push(kvSet(url, token, 'cp_keys', keys));
        // Single analysis save
        if (analysisId !== undefined && analysisData !== undefined) {
          ops.push(kvSet(url, token, 'cp_analysis_' + analysisId, analysisData));
        }
        // Batch analysis saves (from addResultsToPipeline)
        if (Array.isArray(analyses)) {
          analyses.forEach(function(a) {
            if (a.id !== undefined && a.data !== undefined) {
              ops.push(kvSet(url, token, 'cp_analysis_' + a.id, a.data));
            }
          });
        }
        await Promise.all(ops);
        return res.status(200).json({ ok: true });
      }
    }

    // Fallback: in-memory
    if (req.method === 'GET') {
      return res.status(200).json({
        pipeline: memoryStore.pipeline,
        keys: memoryStore.keys,
        analyses: memoryStore.analyses || {}
      });
    }
    if (req.method === 'POST') {
      const { pipeline, keys, analysisId, analysisData, analyses } = req.body;
      if (pipeline !== undefined) memoryStore.pipeline = pipeline;
      if (keys !== undefined) memoryStore.keys = keys;
      if (!memoryStore.analyses) memoryStore.analyses = {};
      if (analysisId !== undefined && analysisData !== undefined) {
        memoryStore.analyses[analysisId] = analysisData;
      }
      if (Array.isArray(analyses)) {
        analyses.forEach(function(a) {
          if (a.id !== undefined && a.data !== undefined) {
            memoryStore.analyses[a.id] = a.data;
          }
        });
      }
      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('[Pipeline]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
