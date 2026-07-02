/**
 * Onchain data routes — JWT-protected.
 * Two surfaces:
 *   1. Per-user Moralis key management (connect/disconnect/status)
 *   2. Direct REST proxies to DefiLlama (no key) and Moralis (user key)
 *
 * Mobile client can call these directly OR let the chat agent invoke them
 * via tool calls — both paths share the underlying services.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/encryption');
const { query } = require('../db/client');
const defillama = require('../services/defillama');
const moralis = require('../services/moralis');

const router = express.Router();
router.use(authenticate);

// ---------------- Moralis key management ---------------------------

router.post('/moralis/connect', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
  try {
    const ok = await moralis.ping(apiKey);
    if (!ok) return res.status(400).json({ error: 'Moralis API key rejected by server' });
    const enc = encrypt(apiKey.trim());
    await query(
      `INSERT INTO api_keys (user_id, provider, encrypted_key, label)
       VALUES ($1, 'moralis', $2, 'Moralis Web3 API')
       ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = $2`,
      [req.user.userId, enc]
    );
    res.json({ connected: true });
  } catch (err) {
    console.error('Moralis connect error:', err);
    res.status(500).json({ error: err.message || 'Failed to connect Moralis' });
  }
});

router.get('/moralis/status', async (req, res) => {
  try {
    const r = await query(
      "SELECT 1 FROM api_keys WHERE user_id = $1 AND provider = 'moralis'",
      [req.user.userId]
    );
    res.json({ connected: r.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: 'status check failed' });
  }
});

router.delete('/moralis', async (req, res) => {
  try {
    await query("DELETE FROM api_keys WHERE user_id = $1 AND provider = 'moralis'", [req.user.userId]);
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: 'disconnect failed' });
  }
});

async function getUserMoralisKey(userId) {
  const r = await query(
    "SELECT encrypted_key FROM api_keys WHERE user_id = $1 AND provider = 'moralis'",
    [userId]
  );
  if (r.rows.length === 0) return null;
  return decrypt(r.rows[0].encrypted_key);
}

function requireMoralis(req, res, next) {
  getUserMoralisKey(req.user.userId).then((k) => {
    if (!k) return res.status(400).json({ error: 'No Moralis key. Connect via /onchain/moralis/connect.' });
    req.moralisKey = k;
    next();
  }).catch((e) => res.status(500).json({ error: e.message }));
}

// ---------------- DefiLlama (no key required) ----------------------

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (err) { console.error(req.path, err); res.status(500).json({ error: err.message || 'failed' }); }
};

router.get('/defillama/protocol/:slug', wrap((req) => defillama.getProtocolTvl(req.params.slug)));
router.get('/defillama/chain/:chain', wrap((req) => defillama.getChainTvl(req.params.chain)));
router.get('/defillama/protocols', wrap((req) => defillama.getTopProtocols(req.query)));
router.post('/defillama/prices', wrap((req) => defillama.getTokenPrices(req.body.coins || [])));
router.get('/defillama/chart/:coinId', wrap((req) => defillama.getTokenChart(req.params.coinId, req.query.period, parseInt(req.query.span || '30'))));
router.get('/defillama/dex/:chain', wrap((req) => defillama.getDexVolume(req.params.chain)));
router.get('/defillama/perps', wrap((req) => defillama.getPerpsVolume(req.query.chain || 'all')));
router.get('/defillama/stablecoins', wrap(() => defillama.getStablecoinFlows()));
router.get('/defillama/stablecoins/:chain', wrap((req) => defillama.getStablecoinChainFlows(req.params.chain)));
router.get('/defillama/yields', wrap((req) => defillama.getTopYields(req.query)));

// ---------------- Moralis (per-user key) ---------------------------

router.get('/moralis/price/:chain/:address',
  requireMoralis,
  wrap((req) => moralis.getTokenPrice(req.moralisKey, { chain: req.params.chain, address: req.params.address }))
);

router.get('/moralis/metadata/:chain/:address',
  requireMoralis,
  wrap((req) => moralis.getTokenMetadata(req.moralisKey, { chain: req.params.chain, address: req.params.address }))
);

router.get('/moralis/holders/:chain/:address',
  requireMoralis,
  wrap((req) => moralis.getTokenHolders(req.moralisKey, { chain: req.params.chain, address: req.params.address, limit: parseInt(req.query.limit || '25') }))
);

router.get('/moralis/wallet/:chain/:address/tokens',
  requireMoralis,
  wrap((req) => moralis.getWalletTokens(req.moralisKey, { chain: req.params.chain, address: req.params.address }))
);

router.get('/moralis/wallet/:chain/:address/pnl',
  requireMoralis,
  wrap((req) => moralis.getWalletPnl(req.moralisKey, { chain: req.params.chain, address: req.params.address, days: req.query.days || 'all' }))
);

router.get('/moralis/wallet/:chain/:address/swaps',
  requireMoralis,
  wrap((req) => moralis.getWalletSwaps(req.moralisKey, { chain: req.params.chain, address: req.params.address, limit: parseInt(req.query.limit || '25') }))
);

router.get('/moralis/transfers/:chain/:address',
  requireMoralis,
  wrap((req) => moralis.getTokenTransfers(req.moralisKey, { chain: req.params.chain, address: req.params.address, limit: parseInt(req.query.limit || '25') }))
);

router.get('/moralis/top-gainers',
  requireMoralis,
  wrap((req) => moralis.getTopGainers(req.moralisKey, req.query))
);

router.get('/moralis/trending',
  requireMoralis,
  wrap((req) => moralis.getTrendingTokens(req.moralisKey, req.query))
);

// Pulse endpoint — one call for an at-a-glance macro snapshot (used by mobile dashboard)
router.get('/pulse', wrap(async () => {
  const [stables, perps, ethTvl] = await Promise.all([
    defillama.getStablecoinFlows().catch(() => null),
    defillama.getPerpsVolume('all').catch(() => null),
    defillama.getChainTvl('Ethereum').catch(() => null),
  ]);
  return {
    stablecoinTotalUsd: stables?.totalUsd ?? null,
    stablecoinTopChange7d: stables?.top?.[0]?.change7d ?? null,
    perpsVolume24hUsd: perps?.total24h ?? null,
    perpsChange7d: perps?.change7d ?? null,
    ethereumTvlUsd: ethTvl?.tvlUsd ?? null,
    ethereumTvlChange7d: ethTvl?.change7d ?? null,
  };
}));

module.exports = router;
module.exports.getUserMoralisKey = getUserMoralisKey;
