const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../db/client');
const { processMessage } = require('../agents/session-manager');
const { decrypt } = require('../services/encryption');

const router = express.Router();
router.use(authenticate);

// Get conversation history
router.get('/history', async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const result = await query(
      'SELECT id, role, content, metadata, created_at FROM conversations WHERE user_id = $1 ORDER BY created_at ASC LIMIT $2',
      [req.user.userId, parseInt(limit)]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send a chat message (streaming response via SSE)
router.post('/message', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Check for user-provided LLM API key
    let userApiKey = null;
    let userProvider = null;
    const keyResult = await query(
      "SELECT provider, encrypted_key FROM api_keys WHERE user_id = $1 AND provider IN ('anthropic', 'openai') LIMIT 2",
      [req.user.userId]
    );
    if (keyResult.rows.length > 0) {
      const keyRow = keyResult.rows[0];
      userApiKey = decrypt(keyRow.encrypted_key);
      userProvider = keyRow.provider;
    }

    const result = await processMessage({
      userId: req.user.userId,
      userMessage: message,
      userApiKey,
      userProvider,
    });

    // Send full response as SSE
    res.write(`data: ${JSON.stringify({ type: 'message', content: result.content, tradeRecommendation: result.tradeRecommendation })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
