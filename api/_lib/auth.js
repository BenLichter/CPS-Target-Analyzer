import { createHmac, timingSafeEqual } from 'node:crypto';

function parseCookies(req) {
  var header = req.headers && req.headers.cookie;
  if (!header) return {};
  var cookies = {};
  header.split(';').forEach(function(part) {
    var idx = part.indexOf('=');
    if (idx < 0) return;
    var key = part.slice(0, idx).trim();
    var val = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = val;
  });
  return cookies;
}

export function verifyAuth(req) {
  var secret = process.env.AUTH_SECRET;
  if (!secret) return false;

  var cookies = parseCookies(req);
  var token = cookies['cp_auth'];
  if (!token) return false;

  var dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return false;

  var payload = token.slice(0, dotIdx);
  var sig = token.slice(dotIdx + 1);

  var expected = createHmac('sha256', secret).update(payload).digest('base64url');

  try {
    var sigBuf = Buffer.from(sig + '==', 'base64');
    var expectedBuf = Buffer.from(expected + '==', 'base64');
    if (sigBuf.length !== expectedBuf.length) return false;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return false;
  } catch (e) {
    return false;
  }

  try {
    var data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return false;
    return true;
  } catch (e) {
    return false;
  }
}
