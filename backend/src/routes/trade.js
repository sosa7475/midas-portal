const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../db/client');
const orderly = require('../services/orderly');
const { getUserOrderlyCreds } = require('./wallet');

const router = express.Router();
router.use(authenticate);

// Confirm and execute a trade
router.post('/confirm', async (req, res) => {
  const { pair, side, size, entry, stopLoss, takeProfit, orderType = 'MARKET', strategyId, screenshotUrl, agentReasoning } = req.body;

  if (!pair || !side || !size) {
    return res.status(400).json({ error: 'pair, side, and size are required' });
  }

  try {
    const creds = await getUserOrderlyCreds(req.user.userId);
    if (!creds) return res.status(400).json({ error: 'No Orderly credentials. Connect your wallet first.' });

    // Execute via Orderly SDK (pre-built call, no code generation)
    const execution = await orderly.placeOrder({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      pair,
      side,
      size: parseFloat(size),
      orderType,
      price: entry ? parseFloat(entry) : null,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
    });

    // Log to journal
    const result = await query(
      `INSERT INTO trades (user_id, strategy_id, pair, side, size, entry_price, stop_loss, take_profit, order_id, status, screenshot_url, agent_reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, pair, side, size, entry_price, order_id, status, created_at`,
      [
        req.user.userId,
        strategyId || null,
        pair,
        side,
        size,
        entry || null,
        stopLoss || null,
        takeProfit || null,
        execution.orderId,
        execution.status,
        screenshotUrl || null,
        agentReasoning || null,
      ]
    );

    res.json({ trade: result.rows[0], execution });
  } catch (err) {
    console.error('Trade execution error:', err);
    res.status(500).json({ error: err.message || 'Trade execution failed' });
  }
});

// Trade history / journal
router.get('/history', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  try {
    const result = await query(
      `SELECT t.*, s.name as strategy_name
       FROM trades t
       LEFT JOIN strategies s ON t.strategy_id = s.id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.userId, parseInt(limit), parseInt(offset)]
    );
    res.json({ trades: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// Single trade status
router.get('/:tradeId', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM trades WHERE id = $1 AND user_id = $2',
      [req.params.tradeId, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Trade not found' });

    const trade = result.rows[0];

    // If order is still pending, check Orderly for update
    if (trade.order_id && trade.status === 'confirmed') {
      try {
        const creds = await getUserOrderlyCreds(req.user.userId);
        if (creds) {
          const orderStatus = await orderly.getOrderStatus({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, orderId: trade.order_id });
          if (orderStatus?.status && orderStatus.status !== trade.status) {
            await query('UPDATE trades SET status = $1, updated_at = NOW() WHERE id = $2', [orderStatus.status.toLowerCase(), trade.id]);
            trade.status = orderStatus.status.toLowerCase();
          }
        }
      } catch {
        // Non-fatal; return cached status
      }
    }

    res.json({ trade });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

module.exports = router;
