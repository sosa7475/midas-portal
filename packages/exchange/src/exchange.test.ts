import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignatureMessage,
  generateOrderlyKey,
  orderlyKeyFromSecret,
  signRequest,
} from "./ed25519.js";
import { deriveAccountId } from "./registration.js";
import { checkTrade, sizeFromRisk, DEFAULT_LIMITS } from "./risk.js";

test("signature message is timestamp+METHOD+path+body", () => {
  assert.equal(
    buildSignatureMessage(1700000000000, "get", "/v1/positions"),
    "1700000000000GET/v1/positions"
  );
  assert.equal(
    buildSignatureMessage(1700000000000, "post", "/v1/order", '{"symbol":"PERP_BTC_USDC"}'),
    '1700000000000POST/v1/order{"symbol":"PERP_BTC_USDC"}'
  );
});

test("generated orderly-key round-trips to the same public key", () => {
  const kp = generateOrderlyKey();
  assert.match(kp.orderlyKey, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(orderlyKeyFromSecret(kp.secretHex), kp.orderlyKey);
});

test("signRequest produces the required orderly headers", () => {
  const kp = generateOrderlyKey();
  const headers = signRequest({
    secretHex: kp.secretHex,
    accountId: "0xabc",
    orderlyKey: kp.orderlyKey,
    timestamp: 1700000000000,
    method: "GET",
    path: "/v1/client/holding",
  });
  assert.equal(headers["orderly-account-id"], "0xabc");
  assert.equal(headers["orderly-key"], kp.orderlyKey);
  assert.equal(headers["orderly-timestamp"], "1700000000000");
  assert.ok(headers["orderly-signature"].length > 0);
});

test("account id is deterministic keccak of address + broker", () => {
  const a = deriveAccountId("0x0000000000000000000000000000000000000001", "midas_portal");
  const b = deriveAccountId("0x0000000000000000000000000000000000000001", "midas_portal");
  assert.equal(a, b);
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test("risk engine blocks oversized notional and over-leverage", () => {
  const v = checkTrade(
    { notionalUsd: 20000, leverage: 25, entry: 100, quantity: 200 },
    { equityUsd: 1000, realizedPnlTodayUsd: 0 }
  );
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => /notional/.test(x)));
  assert.ok(v.violations.some((x) => /Leverage/.test(x)));
});

test("risk engine halts after daily loss limit", () => {
  const v = checkTrade(
    { notionalUsd: 100, leverage: 1, entry: 100, quantity: 1 },
    { equityUsd: 1000, realizedPnlTodayUsd: -DEFAULT_LIMITS.maxDailyLossUsd }
  );
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => /Daily loss/.test(x)));
});

test("sizeFromRisk sizes so stop distance equals risk budget", () => {
  // $1000 equity, risk 2% = $20; entry 100 stop 96 => $4/unit => 5 units
  const qty = sizeFromRisk({ equityUsd: 1000, riskPct: 2, entry: 100, stopLoss: 96 });
  assert.equal(qty, 5);
});
