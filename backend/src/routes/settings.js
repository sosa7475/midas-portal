const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../db/client');
const { encrypt, decrypt } = require('../services/encryption');

const router = express.Router();
router.use(authenticate);

const ALLOWED_PROVIDERS = ['anthropic', 'openai'];

// Save user LLM API key
router.post('/api-key', async (req, res) => {
  const { provider, apiKey } = req.body;
  if (!ALLOWED_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Provider must be anthropic or openai' });
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  try {
    const encryptedKey = encrypt(apiKey);
    await query(
      `INSERT INTO api_keys (user_id, provider, encrypted_key, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = $3`,
      [req.user.userId, provider, encryptedKey, `${provider} API`]
    );
    res.json({ saved: true, provider });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// Get saved providers (key values are never returned)
router.get('/api-keys', async (req, res) => {
  try {
    const result = await query(
      "SELECT provider, label, created_at FROM api_keys WHERE user_id = $1 AND provider IN ('anthropic', 'openai')",
      [req.user.userId]
    );
    res.json({ providers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Delete a provider API key
router.delete('/api-key/:provider', async (req, res) => {
  if (!ALLOWED_PROVIDERS.includes(req.params.provider)) return res.status(400).json({ error: 'Invalid provider' });
  try {
    await query('DELETE FROM api_keys WHERE user_id = $1 AND provider = $2', [req.user.userId, req.params.provider]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

module.exports = router;
