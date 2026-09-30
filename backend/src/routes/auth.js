const express = require('express');
const bcrypt = require('bcryptjs');
const { validateSessionConfig, sessionToken } = require('../services/session-token');
const { query } = require('../db/client');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || email.length > 255 ||
      typeof password !== 'string' || !password || password.length > 4096) {
    return res.status(400).json({ error: 'Valid email and password required' });
  }
  try { validateSessionConfig(); }
  catch { return res.status(503).json({ error: 'Authentication temporarily unavailable' }); }

  if (Buffer.byteLength(password, 'utf8') > 72 ||
      (displayName != null && (typeof displayName !== 'string' || displayName.length > 100))) {
    return res.status(400).json({ error: 'Password exceeds 72 bytes or display name is invalid' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at',
      [email.toLowerCase(), passwordHash, displayName || null]
    );
    const user = result.rows[0];
    const token = sessionToken(user);

    res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || email.length > 255 ||
      typeof password !== 'string' || !password || password.length > 4096) {
    return res.status(400).json({ error: 'Valid email and password required' });
  }
  try { validateSessionConfig(); }
  catch { return res.status(503).json({ error: 'Authentication temporarily unavailable' }); }

  try {
    const result = await query('SELECT id, email, password_hash, display_name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = sessionToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
