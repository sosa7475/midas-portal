/**
 * Orderly Network / QuickPerps SDK integration.
 * All trade execution uses pre-built templates — no code generation at runtime.
 * Targets Polygon / QuickPerps via Orderly's perps API.
 */

const crypto = require('crypto');

const BASE_URL = process.env.ORDERLY_BASE_URL || 'https://api-evm.orderly.org';
const BROKER_ID = process.env.ORDERLY_BROKER_ID || 'midas_portal';

function signRequest(apiSecret, timestamp, method, path, body = '') {
  const message = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac('sha256', apiSecret).update(message).digest('base64');
}

async function request(method, path, body, apiKey, apiSecret) {
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const signature = signRequest(apiSecret, timestamp, method.toUpperCase(), path, bodyStr);

  const headers = {
    'Content-Type': 'application/json',
    'orderly-timestamp': timestamp,
    'orderly-account-id': apiKey,
    'orderly-signature': signature,
    'orderly-broker-id': BROKER_ID,
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Orderly API error ${response.status}: ${errBody}`);
  }
  return response.json();
}

async function getBalance(apiKey, apiSecret) {
  const result = await request('GET', '/v1/client/holding', null, apiKey, apiSecret);
  return {
    totalCollateral: result.data?.total_collateral_value,
    freeCollateral: result.data?.free_collateral,
    holdings: result.data?.holding || [],
  };
}

async function getPositions(apiKey, apiSecret) {
  const result = await request('GET', '/v1/positions', null, apiKey, apiSecret);
  return result.data?.rows || [];
}

async function placeOrder({ apiKey, apiSecret, pair, side, size, orderType = 'MARKET', price = null, stopLoss = null, takeProfit = null }) {
  const body = {
    symbol: pair,
    order_type: orderType,
    side: side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
    order_quantity: size,
    broker_id: BROKER_ID,
  };

  if (orderType === 'LIMIT' && price) body.order_price = price;
  if (stopLoss) body.visible_quantity = 0; // Orderly perp SL via algo order

  const result = await request('POST', '/v1/order', body, apiKey, apiSecret);
  const orderId = result.data?.order_id;

  // Place stop-loss as a separate algo order if provided
  if (orderId && stopLoss) {
    await placeAlgoOrder({ apiKey, apiSecret, pair, side: side === 'long' ? 'short' : 'long', triggerPrice: stopLoss, size, type: 'STOP_MARKET' });
  }
  if (orderId && takeProfit) {
    await placeAlgoOrder({ apiKey, apiSecret, pair, side: side === 'long' ? 'short' : 'long', triggerPrice: takeProfit, size, type: 'TAKE_PROFIT_MARKET' });
  }

  return { orderId, status: result.data?.status || 'submitted', raw: result.data };
}

async function placeAlgoOrder({ apiKey, apiSecret, pair, side, triggerPrice, size, type }) {
  const body = {
    symbol: pair,
    algo_type: type,
    side: side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
    quantity: size,
    trigger_price: triggerPrice,
    broker_id: BROKER_ID,
  };
  return request('POST', '/v1/algo/order', body, apiKey, apiSecret);
}

async function cancelOrder({ apiKey, apiSecret, orderId, pair }) {
  return request('DELETE', `/v1/order?order_id=${orderId}&symbol=${pair}`, null, apiKey, apiSecret);
}

async function getOrderStatus({ apiKey, apiSecret, orderId }) {
  const result = await request('GET', `/v1/order/${orderId}`, null, apiKey, apiSecret);
  return result.data;
}

async function getMarketInfo(pair) {
  const result = await fetch(`${BASE_URL}/v1/public/info/${pair}`);
  const data = await result.json();
  return data.data;
}

async function getTicker(pair) {
  const result = await fetch(`${BASE_URL}/v1/public/futures/${pair}`);
  const data = await result.json();
  return data.data;
}

module.exports = { getBalance, getPositions, placeOrder, cancelOrder, getOrderStatus, getMarketInfo, getTicker };
