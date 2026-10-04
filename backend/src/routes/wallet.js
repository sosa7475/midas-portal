const express = require('express');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/encryption');
const { query } = require('../db/client');
const orderlyService = require('../services/orderly');

const router = express.Router();
router.use(authenticate);

// Connect Orderly API credentials
router.post('/connect', async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API key and secret required' });

  try {
    const encryptedKey = encrypt(apiKey);
    const encryptedSecret = encrypt(apiSecret);

    await query(
      `INSERT INTO api_keys (user_id, provider, encrypted_key, encrypted_secret, label)
       VALUES ($1, 'orderly', $2, $3, 'Orderly API')
       ON CONFLICT (user_id, provider) DO UPDATE
       SET encrypted_key = $2, encrypted_secret = $3`,
      [req.user.userId, encryptedKey, encryptedSecret]
    );

    // Test the credentials
    const balance = await orderlyService.getBalance(apiKey, apiSecret);
    res.json({ connected: true, balance });
  } catch (err) {
    console.error('Wallet connect error:', err);
    res.status(500).json({ error: 'Failed to connect wallet' });
  }
});

// Get wallet balance
router.get('/balance', async (req, res) => {
  try {
    const creds = await getUserOrderlyCreds(req.user.userId);
    if (!creds) return res.status(400).json({ error: 'No Orderly credentials found. Please connect your wallet first.' });

    const balance = await orderlyService.getBalance(creds.apiKey, creds.apiSecret);
    res.json(balance);
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

async function getUserOrderlyCreds(userId) {
  const result = await query(
    "SELECT encrypted_key, encrypted_secret FROM api_keys WHERE user_id = $1 AND provider = 'orderly'",
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { apiKey: decrypt(row.encrypted_key), apiSecret: decrypt(row.encrypted_secret) };
}

module.exports = router;
module.exports.getUserOrderlyCreds = getUserOrderlyCreds;
