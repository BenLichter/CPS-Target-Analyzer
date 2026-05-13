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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  var kvUrl = process.env.KV_REST_API_URL;
  var kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: 'KV not configured' });

  if (req.method === 'GET') {
    try {
      var decks = (await kvGet(kvUrl, kvToken, 'collateral:decks')) || [];
      var deck = decks.find(function(d) { return d.id === id; });
      if (!deck) return res.status(404).json({ error: 'Deck not found' });
      return res.status(200).json({ deck: deck });
    } catch (error) {
      console.error('[collateral/deck GET]', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      var decks = (await kvGet(kvUrl, kvToken, 'collateral:decks')) || [];
      var updated = decks.filter(function(d) { return d.id !== id; });
      await kvSet(kvUrl, kvToken, 'collateral:decks', updated);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[collateral/deck DELETE]', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
