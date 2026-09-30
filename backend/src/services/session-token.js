const jwt = require('jsonwebtoken');

function sessionSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error('JWT_SECRET must be configured');
  }
  return secret; // Preserve the exact bytes used by existing valid tokens.
}

function sessionToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, sessionSecret(), {
    algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// Check expiry configuration before registration can create a database row.
function validateSessionConfig() {
  sessionToken({ id: 'configuration-check', email: '' });
}

module.exports = { sessionSecret, sessionToken, validateSessionConfig };
