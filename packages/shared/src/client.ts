/**
 * Typed API client for the Midas API (apps/api on Fly).
 * Framework-agnostic: works in the browser, Next.js, and React Native.
 * Responses are validated with the shared zod schemas — contract drift fails loudly.
 */

import { z } from "zod";
import { AuthResponse, LoginRequest, RegisterRequest } from "./schemas/auth.js";
import { ChatHistoryResponse, ChatStreamEvent } from "./schemas/chat.js";
import { AgentResponse, DefineStrategyRequest, Strategy } from "./schemas/strategy.js";
import { ConfirmTradeRequest, Trade, TradeHistoryResponse } from "./schemas/trade.js";
import { ConnectWalletRequest, WalletBalance } from "./schemas/wallet.js";
import { ApiKeysResponse, SaveApiKeyRequest } from "./schemas/settings.js";

export interface MidasClientOptions {
  baseUrl: string;
  /** Returns the current auth token (or null). Called per request. */
  getToken: () => string | null | Promise<string | null>;
  /** Called on a 401 so the host app can log out. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createMidasClient(opts: MidasClientOptions) {
  const f = opts.fetchImpl ?? fetch;

  async function request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const token = await opts.getToken();
    const res = await f(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) opts.onUnauthorized?.();
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message);
    }
    return schema.parse(await res.json());
  }

  return {
    auth: {
      register: (req: RegisterRequest) => request("POST", "/auth/register", AuthResponse, req),
      login: (req: LoginRequest) => request("POST", "/auth/login", AuthResponse, req),
    },
    wallet: {
      connect: (req: ConnectWalletRequest) =>
        request("POST", "/wallet/connect", z.object({ connected: z.boolean(), balance: WalletBalance }), req),
      balance: () => request("GET", "/wallet/balance", WalletBalance),
    },
    strategy: {
      get: () => request("GET", "/strategy", z.object({ strategy: Strategy.nullable() })),
      define: (req: DefineStrategyRequest) =>
        request("POST", "/strategy/define", z.object({ strategy: Strategy }), req),
      tradeIdea: (idea: string) => request("POST", "/strategy/trade-idea", AgentResponse, { idea }),
    },
    trade: {
      confirm: (req: ConfirmTradeRequest) =>
        request("POST", "/trade/confirm", z.object({ trade: Trade }).passthrough(), req),
      history: (limit = 50, offset = 0) =>
        request("GET", `/trade/history?limit=${limit}&offset=${offset}`, TradeHistoryResponse),
      get: (id: string) => request("GET", `/trade/${id}`, z.object({ trade: Trade })),
    },
    chat: {
      history: (limit = 50) => request("GET", `/chat/history?limit=${limit}`, ChatHistoryResponse),
    },
    settings: {
      saveApiKey: (req: SaveApiKeyRequest) =>
        request("POST", "/settings/api-key", z.object({ saved: z.boolean(), provider: z.string() }), req),
      apiKeys: () => request("GET", "/settings/api-keys", ApiKeysResponse),
      deleteApiKey: (provider: string) =>
        request("DELETE", `/settings/api-key/${provider}`, z.object({ deleted: z.boolean() })),
    },
    health: () => request("GET", "/health", z.object({ status: z.string(), timestamp: z.string() })),
  };
}

export type MidasClient = ReturnType<typeof createMidasClient>;

/** Parse one SSE `data:` payload from /chat/message into a typed event (null for [DONE]/junk). */
export function parseChatStreamData(data: string): ChatStreamEvent | null {
  if (data === "[DONE]") return null;
  try {
    return ChatStreamEvent.parse(JSON.parse(data));
  } catch {
    return null;
  }
}
