const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const { query } = require('../db/client');
const { processMessage, invalidateStrategyCache } = require('../agents/session-manager');
const { chat } = require('../services/llm-adapter');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  // In-memory storage: no disk writes (required for read-only serverless
  // filesystems like Vercel). The image is read straight from req.file.buffer.
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Define / update strategy in natural language
router.post('/define', async (req, res) => {
  const { rulesText, name } = req.body;
  if (!rulesText) return res.status(400).json({ error: 'Strategy rules text required' });

  try {
    // Parse rules with LLM
    const parseResponse = await chat({
      messages: [
        {
          role: 'user',
          content: `Parse this trading strategy into structured JSON rules. Extract: entry conditions, risk parameters, position sizing rules, exit rules, and any filters.

Strategy: "${rulesText}"

Return ONLY valid JSON in this schema:
{
  "entryConditions": [string],
  "riskPerTrade": string,
  "positionSizing": string,
  "stopLossRule": string,
  "takeProfitRule": string,
  "filters": [string],
  "notes": string
}`,
        },
      ],
      systemPrompt: 'You are a trading strategy parser. Return only valid JSON, no markdown.',
    });

    let parsedRules = null;
    try {
      const jsonStr = parseResponse.content.replace(/```json|```/g, '').trim();
      parsedRules = JSON.parse(jsonStr);
    } catch {
      // Parsing failed; store as-is
    }

    await query('UPDATE strategies SET is_active = false WHERE user_id = $1', [req.user.userId]);

    const result = await query(
      'INSERT INTO strategies (user_id, name, rules_text, parsed_rules_json) VALUES ($1, $2, $3, $4) RETURNING id, name, rules_text, created_at',
      [req.user.userId, name || 'My Strategy', rulesText, parsedRules ? JSON.stringify(parsedRules) : null]
    );

    invalidateStrategyCache(req.user.userId);
    res.json({ strategy: result.rows[0], parsedRules });
  } catch (err) {
    console.error('Strategy define error:', err);
    res.status(500).json({ error: 'Failed to save strategy' });
  }
});

// Get active strategy
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, rules_text, parsed_rules_json, created_at FROM strategies WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1',
      [req.user.userId]
    );
    res.json({ strategy: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
});

// Analyze screenshot — returns trade recommendation
router.post('/analyze-screenshot', upload.single('screenshot'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Screenshot required' });
  const { notes } = req.body;

  try {
    const imageBase64 = req.file.buffer.toString('base64');
    const imageMimeType = req.file.mimetype || 'image/png';

    const userMessage = notes
      ? `Analyze this chart screenshot. My notes: "${notes}". Does this match my strategy? What trade do you recommend?`
      : 'Analyze this chart screenshot. Does it match my strategy? What trade do you recommend?';

    const result = await processMessage({
      userId: req.user.userId,
      userMessage,
      imageBase64,
      imageMimeType,
    });

    res.json(result);
  } catch (err) {
    console.error('Screenshot analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze screenshot' });
  }
});

// Direct trade idea via text
router.post('/trade-idea', async (req, res) => {
  const { idea } = req.body;
  if (!idea) return res.status(400).json({ error: 'Trade idea required' });

  try {
    const result = await processMessage({
      userId: req.user.userId,
      userMessage: idea,
    });
    res.json(result);
  } catch (err) {
    console.error('Trade idea error:', err);
    res.status(500).json({ error: 'Failed to process trade idea' });
  }
});

module.exports = router;
