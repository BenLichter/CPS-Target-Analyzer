import { verifyAuth } from './_lib/auth.js';
let memoryStore = { pipeline: [], keys: null, analyses: {} };

function parseArrSimple(s) {
  if (!s) return 0;
  var raw = String(s).trim();
  var match = raw.match(/\$?([0-9,]+(?:\.[0-9]+)?)\s*(T|B|M|K|t|b|m|k)?/);
  if (!match) return 0;
  var num = parseFloat(match[1].replace(/,/g, ''));
  var unit = (match[2] || '').toUpperCase();
  if (unit === 'T') return num * 1e12;
  if (unit === 'B') return num * 1e9;
  if (unit === 'M') return num * 1e6;
  if (unit === 'K') return num * 1e3;
  return num || 0;
}
function fmtArrSimple(n) {
  if (!n) return '';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '')  + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '')  + 'M';
  if (n >= 1e3)  return '$' + (n / 1e3).toFixed(2).replace(/\.?0+$/, '')  + 'K';
  return '$' + Math.round(n);
}

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

        // One-time rollback: restore deal.arr = financials.projected_arr after aborted SOM migration
        if (Array.isArray(pipeline)) {
          const somMigrated = await kvGet(url, token, 'cp_pipeline:som_migrated');
          if (somMigrated) {
            var restored = pipeline.map(function(d) {
              if (!d) return d;
              var origArr = (d.financials && d.financials.projected_arr) ? d.financials.projected_arr : d.arr;
              var patched = Object.assign({}, d, { arr: origArr });
              delete patched.som;
              return patched;
            });
            await Promise.all([
              kvSet(url, token, 'cp_pipeline', restored),
              kvSet(url, token, 'cp_pipeline:som_migrated', false),
            ]);
            pipeline = restored;
          }
        }

        // One-time migration: set projected_arr = SOM for non-broker FS targets
        // where capture rate was incorrectly applied at the per-target level.
        if (Array.isArray(pipeline)) {
          const arrEqSomMigrated = await kvGet(url, token, 'cp_pipeline:arr_eq_som_migrated');
          if (!arrEqSomMigrated) {
            let corrected = 0;
            var fixedArr = pipeline.map(function(d) {
              if (!d) return d;
              if (d.vertical !== 'financial_services') return d;
              if (d.tier === 'brokerage') return d;
              if (!d.financials || !d.financials.som) return d;
              var somVal = parseArrSimple(d.financials.som);
              var projVal = parseArrSimple(d.financials.projected_arr || d.arr || '');
              if (somVal <= 0 || projVal >= somVal * 0.95) return d; // already correct or no haircut
              corrected++;
              var upsideVal = fmtArrSimple(somVal * 3);
              return Object.assign({}, d, {
                arr: d.financials.som,
                financials: Object.assign({}, d.financials, {
                  projected_arr: d.financials.som,
                  upside_arr: upsideVal,
                })
              });
            });
            console.log('[Migration arr_eq_som] Corrected', corrected, 'targets');
            await Promise.all([
              kvSet(url, token, 'cp_pipeline', fixedArr),
              kvSet(url, token, 'cp_pipeline:arr_eq_som_migrated', true),
            ]);
            pipeline = fixedArr;
          }
        }

        // One-time migration: sync d.arr ← financials.projected_arr where they differ >5%.
        // financials.projected_arr is the canonical value (refreshed by each analysis run).
        // d.arr is the legacy top-level field that can drift if analysis updates were partial.
        if (Array.isArray(pipeline)) {
          const arrSyncMigrated = await kvGet(url, token, 'cp_pipeline:arr_sync_migrated');
          if (!arrSyncMigrated) {
            let corrected = 0;
            var offenders = [];
            var syncedArr = pipeline.map(function(d) {
              if (!d) return d;
              if (!d.financials || !d.financials.projected_arr) return d;
              var finVal = parseArrSimple(d.financials.projected_arr);
              var arrVal = parseArrSimple(d.arr || '');
              if (finVal <= 0) return d;
              if (arrVal <= 0 || Math.abs(finVal - arrVal) / finVal > 0.05) {
                corrected++;
                if (offenders.length < 10) offenders.push({ company: d.company, old: d.arr, newArr: d.financials.projected_arr, delta: fmtArrSimple(Math.abs(finVal - arrVal)) });
                return Object.assign({}, d, { arr: d.financials.projected_arr });
              }
              return d;
            });
            console.log('[Migration arr_sync] Corrected', corrected, 'targets. Top offenders:', JSON.stringify(offenders));
            await Promise.all([
              kvSet(url, token, 'cp_pipeline', syncedArr),
              kvSet(url, token, 'cp_pipeline:arr_sync_migrated', true),
            ]);
            pipeline = syncedArr;
          }
        }

        // One-time migration: enforce deterministic FX/Broker formula for all brokerage targets.
        // Formula: projected_arr = annual_volume × 0.00003; upside = projected_arr × 1.5; som = projected_arr.
        // Volume source: d.financials.som (old format stored volume there) or parsed from arr_calculation.
        if (Array.isArray(pipeline)) {
          const fxMigrated = await kvGet(url, token, 'cp_pipeline:fx_formula_migrated');
          if (!fxMigrated) {
            var fxCorrected = 0;
            var fxOutliers = [];
            var fxFixed = pipeline.map(function(d) {
              if (!d) return d;
              if (d.tier !== 'brokerage') return d;

              // Determine annual volume. Old SYS had SOM = total annual volume for FX/Broker.
              // If financials.som >> financials.projected_arr it's still the raw volume.
              var volVal = 0;
              var finSom = parseArrSimple((d.financials && d.financials.som) || '');
              var finArr = parseArrSimple((d.financials && d.financials.projected_arr) || d.arr || '');
              if (finSom > 0 && finArr > 0 && finSom > finArr * 100) {
                // som is clearly the volume (volume >> ARR)
                volVal = finSom;
              } else if (finArr > 0) {
                // Already has ARR; reverse-engineer volume from it as fallback
                // volume = arr / 0.00003
                volVal = finArr / 0.00003;
              }

              // Try parsing volume from arr_calculation string as another fallback
              if (volVal <= 0 && d.financials && d.financials.arr_calculation) {
                var calcStr = String(d.financials.arr_calculation);
                var match = calcStr.match(/\$?([\d,.]+)\s*(T|B|M|K|t|b|m|k)/);
                if (match) {
                  var num = parseFloat(match[1].replace(/,/g, ''));
                  var unit = (match[2] || '').toUpperCase();
                  volVal = unit === 'T' ? num * 1e12 : unit === 'B' ? num * 1e9 : unit === 'M' ? num * 1e6 : unit === 'K' ? num * 1e3 : num;
                }
              }

              if (volVal <= 0) return d; // cannot determine volume, skip

              var newArr = volVal * 0.00003;
              var newUpside = newArr * 1.5;
              var newArrFmt = fmtArrSimple(newArr);
              var newUpsideFmt = fmtArrSimple(newUpside);
              var volFmt = fmtArrSimple(volVal);
              var newCalc = volFmt + ' annual volume × 0.003% (0.3bps per $1M) = ' + newArrFmt + ' ARR';

              var oldArr = finArr;
              var discrepancy = oldArr > 0 ? Math.abs(newArr - oldArr) / Math.max(newArr, oldArr) : 1;
              if (discrepancy > 0.05 || !d.financials || !d.financials.arr_calculation || !d.financials.arr_calculation.includes('0.003%')) {
                fxCorrected++;
                if (fxOutliers.length < 10) fxOutliers.push({ company: d.company, volume: volFmt, oldArr: fmtArrSimple(oldArr), newArr: newArrFmt });
                return Object.assign({}, d, {
                  arr: newArrFmt,
                  financials: Object.assign({}, d.financials || {}, {
                    projected_arr: newArrFmt,
                    upside_arr: newUpsideFmt,
                    som: newArrFmt,
                    arr_calculation: newCalc,
                  })
                });
              }
              return d;
            });
            console.log('[FX/Broker migration] Corrected', fxCorrected, 'targets. Outliers:', JSON.stringify(fxOutliers));
            await Promise.all([
              kvSet(url, token, 'cp_pipeline', fxFixed),
              kvSet(url, token, 'cp_pipeline:fx_formula_migrated', true),
            ]);
            pipeline = fxFixed;
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
