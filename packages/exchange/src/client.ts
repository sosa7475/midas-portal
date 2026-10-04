/**
 * Authenticated Orderly client — full order lifecycle over ed25519-signed requests.
 * Base URL is configurable (testnet default; flip to mainnet with one env var).
 */
import { signRequest } from "./ed25519.js";

export interface OrderlyCreds {
  accountId: string;
  orderlyKey: string;
  secretHex: string;
}

export interface OrderlyClientConfig extends OrderlyCreds {
  baseUrl?: string;
}

export type OrderSide = "long" | "short";
export type OrderType = "MARKET" | "LIMIT" | "IOC" | "FOK" | "POST_ONLY";

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number; // required for LIMIT/IOC/FOK/POST_ONLY
  reduceOnly?: boolean;
  /** Attach a bracket via separate algo orders after entry. */
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

const REGULAR_TYPES = new Set<OrderType>(["MARKET", "LIMIT", "IOC", "FOK", "POST_ONLY"]);

export class OrderlyClient {
  private baseUrl: string;
  private creds: OrderlyCreds;

  constructor(cfg: OrderlyClientConfig) {
    this.baseUrl = cfg.baseUrl ?? process.env.ORDERLY_BASE_URL ?? "https://testnet-api-evm.orderly.org";
    this.creds = { accountId: cfg.accountId, orderlyKey: cfg.orderlyKey, secretHex: cfg.secretHex };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const timestamp = Date.now();
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    const headers = signRequest({
      ...this.creds,
      timestamp,
      method,
      path,
      body: bodyStr,
    });
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { success?: boolean; data?: T; message?: string; code?: number };
    if (!res.ok || json.success === false) {
      throw new Error(`Orderly ${method} ${path}: [${json.code}] ${json.message ?? res.status}`);
    }
    return json.data as T;
  }

  // --- Account / read ---

  getBalance() {
    return this.request<{ total_collateral_value: number; free_collateral: number; holding: any[] }>(
      "GET",
      "/v1/client/holding"
    );
  }

  getPositions() {
    return this.request<{ rows: any[] }>("GET", "/v1/positions").then((d) => d.rows ?? []);
  }

  getOrders(status?: "INCOMPLETE" | "COMPLETED") {
    const q = status ? `?status=${status}` : "";
    return this.request<{ rows: any[] }>("GET", `/v1/orders${q}`).then((d) => d.rows ?? []);
  }

  getFills(symbol?: string) {
    const q = symbol ? `?symbol=${symbol}` : "";
    return this.request<{ rows: any[] }>("GET", `/v1/trades${q}`).then((d) => d.rows ?? []);
  }

  // --- Order lifecycle ---

  async placeOrder(p: PlaceOrderParams) {
    if (!REGULAR_TYPES.has(p.type)) throw new Error(`Unsupported order type ${p.type}`);
    if (p.type !== "MARKET" && p.price === undefined) {
      throw new Error(`${p.type} orders require a price`);
    }
    const body: Record<string, unknown> = {
      symbol: p.symbol,
      order_type: p.type,
      side: p.side === "long" ? "BUY" : "SELL",
      order_quantity: p.quantity,
    };
    if (p.price !== undefined) body.order_price = p.price;
    if (p.reduceOnly) body.reduce_only = true;
    if (p.clientOrderId) body.client_order_id = p.clientOrderId;

    const entry = await this.request<{ order_id: number; status: string }>("POST", "/v1/order", body);

    // Attach bracket (close-side) protection as algo orders.
    const closeSide: OrderSide = p.side === "long" ? "short" : "long";
    if (p.stopLoss) {
      await this.placeAlgoOrder({ symbol: p.symbol, side: closeSide, quantity: p.quantity, triggerPrice: p.stopLoss, algoType: "STOP_MARKET", reduceOnly: true }).catch(() => undefined);
    }
    if (p.takeProfit) {
      await this.placeAlgoOrder({ symbol: p.symbol, side: closeSide, quantity: p.quantity, triggerPrice: p.takeProfit, algoType: "TAKE_PROFIT_MARKET", reduceOnly: true }).catch(() => undefined);
    }
    return entry;
  }

  placeAlgoOrder(p: {
    symbol: string;
    side: OrderSide;
    quantity: number;
    triggerPrice: number;
    algoType: "STOP_MARKET" | "TAKE_PROFIT_MARKET";
    reduceOnly?: boolean;
  }) {
    return this.request<{ order_id: number }>("POST", "/v1/algo/order", {
      symbol: p.symbol,
      algo_type: p.algoType,
      side: p.side === "long" ? "BUY" : "SELL",
      quantity: p.quantity,
      trigger_price: p.triggerPrice,
      reduce_only: p.reduceOnly ?? true,
    });
  }

  cancelOrder(symbol: string, orderId: number) {
    return this.request("DELETE", `/v1/order?order_id=${orderId}&symbol=${symbol}`);
  }

  cancelAll(symbol: string) {
    return this.request("DELETE", `/v1/orders?symbol=${symbol}`);
  }

  /** Market-close a position by placing an opposing reduce-only market order. */
  async closePosition(symbol: string) {
    const positions = await this.getPositions();
    const pos = positions.find((p: any) => p.symbol === symbol && Number(p.position_qty) !== 0);
    if (!pos) throw new Error(`No open position for ${symbol}`);
    const qty = Math.abs(Number(pos.position_qty));
    const side: OrderSide = Number(pos.position_qty) > 0 ? "short" : "long";
    return this.placeOrder({ symbol, side, type: "MARKET", quantity: qty, reduceOnly: true });
  }

  setLeverage(leverage: number) {
    return this.request("POST", "/v1/client/leverage", { leverage });
  }
}
