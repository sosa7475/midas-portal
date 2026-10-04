require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const strategyRoutes = require('./routes/strategy');
const tradeRoutes = require('./routes/trade');
const chatRoutes = require('./routes/chat');
const settingsRoutes = require('./routes/settings');
const onchainRoutes = require('./routes/onchain');

const app = express();
const PORT = process.env.PORT || 3001;

// Note: uploads are handled in-memory (multer.memoryStorage), so no writable
// disk directory is required. This keeps the backend compatible with read-only
// serverless filesystems (e.g. Vercel).

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(limiter);

// Routes
app.use('/auth', authLimiter, authRoutes);
app.use('/wallet', walletRoutes);
app.use('/strategy', strategyRoutes);
app.use('/trade', tradeRoutes);
app.use('/chat', chatRoutes);
app.use('/settings', settingsRoutes);
app.use('/onchain', onchainRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Midas Portal backend running on port ${PORT}`);
  console.log(`LLM Provider: ${process.env.ACTIVE_LLM_PROVIDER || 'openai'}`);
});

module.exports = app;
