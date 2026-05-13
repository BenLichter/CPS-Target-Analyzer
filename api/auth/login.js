import { createHmac, timingSafeEqual } from 'node:crypto';

var failAttempts = {};

function checkRateLimit(ip) {
  var now = Date.now();
  if (!failAttempts[ip] || failAttempts[ip].resetAt < now) {
    failAttempts[ip] = { count: 0, resetAt: now + 60 * 1000 };
  }
  return failAttempts[ip].count < 5;
}

function recordFailure(ip) {
  if (failAttempts[ip]) failAttempts[ip].count++;
}

function clearFailure(ip) {
  delete failAttempts[ip];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var ip = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  }

  var sitePassword = process.env.SITE_PASSWORD;
  var secret = process.env.AUTH_SECRET;

  if (!sitePassword || !secret) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  var body = req.body || {};
  var submitted = String(body.password || '');

  // Timing-safe comparison via HMAC (handles variable-length inputs)
  var submittedHash = createHmac('sha256', secret).update(submitted).digest();
  var expectedHash = createHmac('sha256', secret).update(sitePassword).digest();

  var match = false;
  try {
    match = timingSafeEqual(submittedHash, expectedHash);
  } catch (e) {
    match = false;
  }

  if (!match) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid password' });
  }

  clearFailure(ip);

  var payload = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 24 * 60 * 60 * 1000, v: 1 })).toString('base64url');
  var sig = createHmac('sha256', secret).update(payload).digest('base64url');
  var token = payload + '.' + sig;
  var maxAge = 7 * 24 * 60 * 60;

  res.setHeader('Set-Cookie', 'cp_auth=' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge + '; Path=/');
  return res.status(200).json({ ok: true });
}
