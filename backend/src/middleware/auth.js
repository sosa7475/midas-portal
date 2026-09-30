const jwt = require('jsonwebtoken');
const { query } = require('../db/client');
const { sessionSecret } = require('../services/session-token');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  let secret;
  try { secret = sessionSecret(); }
  catch { return res.status(503).json({ error: 'Authentication temporarily unavailable' }); }
  let claims;
  try {
    claims = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] });
    if (!claims || typeof claims !== 'object' || typeof claims.userId !== 'string' ||
        !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(claims.userId)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
  try {
    const { rows } = await query('SELECT id, email FROM users WHERE id = $1', [claims.userId]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = { ...claims, userId: rows[0].id, email: rows[0].email };
  } catch { return res.status(503).json({ error: 'Authentication temporarily unavailable' }); }
  return next();
}

module.exports = { authenticate };
