import { verifyAuth } from '../_lib/auth.js';
import { Index } from '@upstash/vector';

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(url, token, key, value) {
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var conversationId = body.conversationId || null;
  var message = body.message;
  var priorMessages = Array.isArray(body.messages) ? body.messages : [];
  if (!message) return res.status(400).json({ error: 'Missing message' });

  var kvUrl = process.env.KV_REST_API_URL;
  var kvToken = process.env.KV_REST_API_TOKEN;

  try {
    // Vector search for relevant context
    var index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });

    var searchResults = await index.query({
      data: message,
      topK: 6,
      includeMetadata: true,
    });

    var chunks = searchResults
      .filter(function(r) { return r.metadata && r.metadata.text; })
      .map(function(r) {
        return {
          text: r.metadata.text,
          filename: r.metadata.filename || '',
          chunkIndex: r.metadata.chunkIndex || 0,
          score: r.score,
        };
      });

    // Build system prompt with RAG context
    var contextBlock = chunks.length > 0
      ? chunks.map(function(c) { return '[Source: ' + c.filename + ', chunk ' + c.chunkIndex + ']\n' + c.text; }).join('\n\n')
      : 'No relevant documents found in the library.';

    var systemPrompt = 'You are a CoinPayments sales assistant with access to the company\'s sales collateral library. Use the retrieved document excerpts below to answer questions accurately. Always cite sources by referencing the filename and chunk number.\n\nRETRIEVED CONTEXT:\n' + contextBlock + '\n\nInstructions:\n- Answer based on the retrieved context when relevant\n- If context does not contain the answer, say so clearly\n- Be concise, professional, and sales-focused\n- Cite using the format: (Source: filename, chunk N)';

    var claudeMessages = priorMessages
      .map(function(m) { return { role: m.role, content: m.content }; })
      .concat([{ role: 'user', content: message }]);

    // Start SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    var anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages: claudeMessages,
      }),
    });

    if (!anthropicRes.ok) {
      var errText = await anthropicRes.text();
      res.write('data: ' + JSON.stringify({ error: errText }) + '\n\n');
      return res.end();
    }

    // Relay Anthropic SSE tokens to client
    var fullText = '';
    var reader = anthropicRes.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    while (true) {
      var readResult = await reader.read();
      if (readResult.done) break;
      buf += decoder.decode(readResult.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data: ')) continue;
        var raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          var evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
            var token = evt.delta.text;
            fullText += token;
            res.write('data: ' + JSON.stringify({ token: token }) + '\n\n');
          }
        } catch (e) {}
      }
    }

    // Generate convId and save conversation before closing stream
    var convId = conversationId || crypto.randomUUID();
    var title = message.slice(0, 50) + (message.length > 50 ? '…' : '');
    var now = new Date().toISOString();
    var allMessages = priorMessages
      .concat([{ role: 'user', content: message }])
      .concat([{ role: 'assistant', content: fullText, citations: chunks }]);

    // Send convId + citations to client, then close stream
    res.write('data: ' + JSON.stringify({ citations: chunks, convId: convId, done: true }) + '\n\n');

    // Save to Redis
    if (kvUrl && kvToken) {
      var existing = conversationId
        ? ((await kvGet(kvUrl, kvToken, 'collateral:conversation:' + convId)) || {})
        : {};
      var convObj = Object.assign({}, existing, {
        id: convId,
        title: existing.title || title,
        messages: allMessages,
        createdAt: existing.createdAt || now,
        updatedAt: now,
      });
      await kvSet(kvUrl, kvToken, 'collateral:conversation:' + convId, convObj);

      var convIndex = (await kvGet(kvUrl, kvToken, 'collateral:conversations')) || [];
      var summary = { id: convId, title: convObj.title, lastMessageAt: now, messageCount: allMessages.length };
      var updatedIndex = convIndex.filter(function(c) { return c.id !== convId; });
      updatedIndex.unshift(summary);
      await kvSet(kvUrl, kvToken, 'collateral:conversations', updatedIndex);
    }

    res.end();
  } catch (error) {
    console.error('[collateral/chat]', error.message);
    try { res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n'); res.end(); } catch (e) {}
  }
}
