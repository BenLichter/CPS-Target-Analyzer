import { verifyAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var authenticated = false;
  try {
    authenticated = verifyAuth(req);
  } catch (e) {
    authenticated = false;
  }
  // Always 200 — never 401. The client branches on the body value.
  return res.status(200).json({ authenticated: authenticated });
}
