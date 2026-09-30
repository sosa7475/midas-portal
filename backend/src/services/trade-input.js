// Validate before calling the exchange so the journal can represent the same values.
function decimal(value, field, optional = false) {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && value.length <= 64 &&
        /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) {
    throw new Error(`Invalid ${field}`);
  }
  const number = Number(value);
  // The journal columns are DECIMAL(20, 8). Reject rounding and overflow.
  if (!Number.isFinite(number) || number <= 0 || number >= 1e12 || Number(number.toFixed(8)) !== number) {
    throw new Error(`Invalid ${field}`);
  }
  return number;
}

function validateTradeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid trade request');
  const { pair, side, orderType = 'MARKET', strategyId, screenshotUrl, agentReasoning } = body;
  if (typeof pair !== 'string' || pair.length > 50 || !/^PERP_[A-Z0-9]+_[A-Z0-9]+$/.test(pair)) {
    throw new Error('Invalid pair');
  }
  if (side !== 'long' && side !== 'short') throw new Error('Invalid side');
  if (orderType !== 'MARKET' && orderType !== 'LIMIT') throw new Error('Invalid order type');
  for (const [field, value] of Object.entries({ screenshotUrl, agentReasoning })) {
    if (value != null && typeof value !== 'string') throw new Error(`Invalid ${field}`);
  }
  const size = decimal(body.size, 'size');
  const entry = decimal(body.entry, 'entry', orderType !== 'LIMIT');
  const stopLoss = decimal(body.stopLoss, 'stop loss', true);
  const takeProfit = decimal(body.takeProfit, 'take profit', true);
  return { pair, side, orderType, strategyId, screenshotUrl, agentReasoning, size, entry, stopLoss, takeProfit };
}
module.exports = { validateTradeInput };
