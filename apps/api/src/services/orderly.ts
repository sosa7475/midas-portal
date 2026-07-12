/**
 * Orderly Network integration (perps).
 *
 * PHASE 3 NOTE: real Orderly private-endpoint auth requires **ed25519 orderly-key
 * signing** plus a registered account id — the HMAC scheme below is the MVP's
 * placeholder and WILL 401 against live private endpoints. It is retained so the
 * request plumbing, status mapping, and journal flow can be built/tested now;
 * Phase 3 replaces signRequest/authentication wholesale (see BUILD_SPEC §3).
 */
import crypto from "crypto";
import type { TradeStatus } from "@midas/shared";
import { env } from "../env";

const BASE_URL = env.ORDERLY_BASE_URL;
const BROKER_ID = env.ORDERLY_BROKER_ID;

/** Map Orderly order statuses into the canonical set the DB CHECK allows. */
export function mapOrderlyStatus(raw: string | undefined | null): TradeStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "NEW":
    case "ACCEPTED":
    case "SUBMITTED":
      return "confirmed";
    case "PARTIAL_FILLED":
      return "partial";
    case "FILLED":
      return "filled";
    case "CANCELLED":
    case "CANCEL_SENT":
    case "CANCEL_ALL_AFTER":
      return "cancelled";
    case "REJECTED":
    case "EXPIRED":
      return "rejected";
    default:
      return "pending";
  }
}

function signRequest(apiSecret: string, timestamp: string, method: string, path: string, body = "") {
  const message = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("base64");
}

async function request(
  method: string,
  path: string,
  body: unknown,
  apiKey: string,
  apiSecret: string
) {
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const signature = signRequest(apiSecret, timestamp, method.toUpperCase(), path, bodyStr);

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "orderly-timestamp": timestamp,
      "orderly-account-id": apiKey,
      "orderly-signature": signature,
      "orderly-broker-id": BROKER_ID,
    },
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Orderly API error ${response.status}: ${errBody.slice(0, 500)}`);
  }
  return response.json() as Promise<{ data?: Record<string, any> }>;
}

export async function getBalance(apiKey: string, apiSecret: string) {
  const result = await request("GET", "/v1/client/holding", null, apiKey, apiSecret);
  return {
    totalCollateral: result.data?.total_collateral_value ?? null,
    freeCollateral: result.data?.free_collateral ?? null,
    holdings: result.data?.holding ?? [],
  };
}

export async function getPositions(apiKey: string, apiSecret: string) {
  const result = await request("GET", "/v1/positions", null, apiKey, apiSecret);
  return result.data?.rows ?? [];
}

export interface PlaceOrderParams {
  apiKey: string;
  apiSecret: string;
  pair: string;
  side: "long" | "short";
  size: number;
  orderType?: "MARKET" | "LIMIT";
  price?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

export async function placeOrder(p: PlaceOrderParams) {
  const body: Record<string, unknown> = {
    symbol: p.pair,
    order_type: p.orderType ?? "MARKET",
    side: p.side === "long" ? "BUY" : "SELL",
    order_quantity: p.size,
    broker_id: BROKER_ID,
  };
  if (p.orderType === "LIMIT" && p.price) body.order_price = p.price;

  const result = await request("POST", "/v1/order", body, p.apiKey, p.apiSecret);
  const orderId = result.data?.order_id as string | undefined;

  // SL/TP as algo orders. PHASE 3: link these as an OCO bracket — as written,
  // a TP fill does NOT cancel the SL. Do not enable both on mainnet until fixed.
  if (orderId && p.stopLoss) {
    await placeAlgoOrder(p, p.stopLoss, "STOP_MARKET");
  }
  if (orderId && p.takeProfit) {
    await placeAlgoOrder(p, p.takeProfit, "TAKE_PROFIT_MARKET");
  }

  return {
    orderId: orderId ?? null,
    status: mapOrderlyStatus(result.data?.status as string | undefined),
    raw: result.data,
  };
}

async function placeAlgoOrder(p: PlaceOrderParams, triggerPrice: number, type: string) {
  const body = {
    symbol: p.pair,
    algo_type: type,
    side: p.side === "long" ? "SELL" : "BUY", // close side
    quantity: p.size,
    trigger_price: triggerPrice,
    broker_id: BROKER_ID,
  };
  return request("POST", "/v1/algo/order", body, p.apiKey, p.apiSecret);
}

export async function getOrderStatus(apiKey: string, apiSecret: string, orderId: string) {
  const result = await request("GET", `/v1/order/${orderId}`, null, apiKey, apiSecret);
  return result.data ?? null;
}

export async function getTicker(pair: string) {
  const response = await fetch(`${BASE_URL}/v1/public/futures/${pair}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Orderly public API error ${response.status}`);
  const data = (await response.json()) as { data?: unknown };
  return data.data;
}
