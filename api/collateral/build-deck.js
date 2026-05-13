import { verifyAuth } from '../_lib/auth.js';
import { Index } from '@upstash/vector';

export const maxDuration = 300;

var GAMMA_BASE = 'https://public-api.gamma.app/v1.0';

async function kvGet(url, token, key) {
  var r = await fetch(url + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + token } });
  var data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
}

function sse(res, data) {
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  var body = req.body || {};
  var prompt = (body.prompt || '').trim();
  var docIds = Array.isArray(body.docIds) ? body.docIds : [];
  var cardCount = Math.min(Math.max(parseInt(body.cardCount) || 8, 4), 20);
  var style = body.style || 'pitch';
  var additionalInstructions = (body.additionalInstructions || '').trim();

  if (!prompt) {
    sse(res, { step: 'error', error: 'Prompt is required' });
    return res.end();
  }

  var apiKey = process.env.GAMMA_API_KEY;
  if (!apiKey) {
    sse(res, { step: 'error', error: 'Gamma API not configured' });
    return res.end();
  }

  var kvUrl = process.env.KV_REST_API_URL;
  var kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    sse(res, { step: 'error', error: 'Redis not configured' });
    return res.end();
  }

  if (!process.env.UPSTASH_VECTOR_REST_URL) {
    sse(res, { step: 'error', error: 'Vector DB not configured' });
    return res.end();
  }

  try {
    // ── Step 1: Vector search ─────────────────────────────────────────────────
    sse(res, { step: 'searching', message: 'Searching document library...' });

    var index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });

    var queryResult = await index.query({ data: prompt, topK: 20, includeMetadata: true });

    var chunks = queryResult
      .filter(function(r) { return r.metadata && r.metadata.text; })
      .map(function(r) { return r.metadata; });

    if (docIds.length > 0) {
      chunks = chunks.filter(function(c) { return docIds.indexOf(c.docId) !== -1; });
    }

    // ── Step 2: Build context ─────────────────────────────────────────────────
    sse(res, { step: 'building', message: 'Building context from ' + chunks.length + ' source chunks...' });

    var styleDesc = {
      pitch: 'a B2B sales pitch deck',
      pricing: 'a pricing sheet presentation',
      overview: 'a product overview deck',
      custom: 'a presentation',
    }[style] || 'a presentation';

    var contextParts = chunks.slice(0, 15).map(function(c, i) {
      return '[Source ' + (i + 1) + ': ' + c.filename + ']\n' + c.text;
    });

    var gammaPrompt = [
      'Create ' + styleDesc + ' with exactly ' + cardCount + ' slides.',
      'Topic: ' + prompt,
      contextParts.length > 0
        ? 'Draw all content from these source documents:\n\n' + contextParts.join('\n\n---\n\n')
        : '',
      additionalInstructions ? 'Additional instructions: ' + additionalInstructions : '',
      'Design: dark minimal professional. Each slide: bold headline, key stat or visual, concise supporting text.',
    ].filter(Boolean).join('\n\n');

    // ── Step 3: Start Gamma ───────────────────────────────────────────────────
    sse(res, { step: 'sending', message: 'Connecting to Gamma...' });

    var darkThemeId = null;
    try {
      var tr = await fetch(GAMMA_BASE + '/themes', { headers: { 'X-API-KEY': apiKey } });
      var tdata = await tr.json();
      var themes = Array.isArray(tdata) ? tdata : (tdata.themes || tdata.data || tdata.items || []);
      var darkTheme =
        themes.find(function(t) { return (t.name || '').toLowerCase() === 'dark basic'; }) ||
        themes.find(function(t) { return (t.name || '').toLowerCase().includes('dark') && (t.name || '').toLowerCase().includes('basic'); }) ||
        themes.find(function(t) { return (t.name || '').toLowerCase().includes('dark'); }) ||
        themes[0];
      if (darkTheme) darkThemeId = darkTheme.id || darkTheme.themeId;
    } catch (e) { console.warn('[build-deck] theme fetch failed:', e.message); }

    var genPayload = {
      inputText: gammaPrompt,
      textMode: 'generate',
      format: 'presentation',
      numCards: cardCount,
      textOptions: { language: 'en' },
      additionalInstructions: 'Dark minimal professional B2B design. No individual person names.',
      cardOptions: { dimensions: '16x9' },
    };
    if (darkThemeId) genPayload.themeId = darkThemeId;

    sse(res, { step: 'sending', message: 'Sending to Gamma...' });

    var startRes = await fetch(GAMMA_BASE + '/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(genPayload),
    });

    var startData;
    try { startData = await startRes.json(); } catch (e) { startData = {}; }

    // Retry without themeId if theme validation fails
    if (!startRes.ok && darkThemeId && (JSON.stringify(startData).toLowerCase().includes('theme'))) {
      console.warn('[build-deck] themeId rejected, retrying without it');
      delete genPayload.themeId;
      startRes = await fetch(GAMMA_BASE + '/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify(genPayload),
      });
      try { startData = await startRes.json(); } catch (e) { startData = {}; }
    }

    if (!startRes.ok) {
      throw new Error(startData.error || startData.message || 'Gamma start failed (' + startRes.status + ')');
    }
    if (!startData.generationId) {
      throw new Error('Gamma did not return a generation ID: ' + JSON.stringify(startData).slice(0, 200));
    }

    var generationId = startData.generationId;

    // ── Step 4: Poll Gamma ────────────────────────────────────────────────────
    sse(res, { step: 'generating', message: 'Generating slides (60-90s typically)...' });

    var gammaUrl = null;
    for (var attempt = 0; attempt < 50; attempt++) {
      await sleep(5000);

      var pollRes = await fetch(GAMMA_BASE + '/generations/' + encodeURIComponent(generationId), {
        headers: { 'X-API-KEY': apiKey },
      });
      var pollData;
      try { pollData = await pollRes.json(); } catch (e) { pollData = {}; }

      if (attempt % 3 === 2) {
        sse(res, { step: 'generating', message: 'Generating slides... ' + ((attempt + 1) * 5) + 's elapsed' });
      }

      if (pollData.status === 'completed') {
        gammaUrl = pollData.gammaUrl || pollData.url;
        break;
      }
      if (pollData.status === 'failed') {
        throw new Error('Gamma generation failed: ' + (pollData.error || 'unknown'));
      }
    }

    if (!gammaUrl) throw new Error('Gamma generation timed out after 250s');

    // ── Step 5: Save to Redis ─────────────────────────────────────────────────
    sse(res, { step: 'saving', message: 'Saving to library...' });

    var deckId = crypto.randomUUID();
    var sourceDocs = [];
    chunks.forEach(function(c) { if (sourceDocs.indexOf(c.filename) === -1) sourceDocs.push(c.filename); });

    var deck = {
      id: deckId,
      title: prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt,
      prompt: prompt,
      gammaUrl: gammaUrl,
      createdAt: new Date().toISOString(),
      sourceDocs: sourceDocs,
      chunkCount: chunks.length,
      cardCount: cardCount,
      style: style,
    };

    var existingDecks = (await kvGet(kvUrl, kvToken, 'collateral:decks')) || [];
    existingDecks.unshift(deck);
    await kvSet(kvUrl, kvToken, 'collateral:decks', existingDecks);

    sse(res, { step: 'done', deck: deck });
    res.end();
  } catch (err) {
    console.error('[collateral/build-deck]', err.message);
    sse(res, { step: 'error', error: err.message });
    res.end();
  }
}
