/**
 * Loads Orderly trading credentials from env for the MCP trade tools.
 * Populated by the onboarding CLI (`pnpm --filter @midas/mcp onboard`).
 *
 * Safety switch: even with valid creds, place/cancel/close only fire when
 * MIDAS_TRADING_ENABLED=true — so an agent can never trade on a misconfig.
 */
import { OrderlyClient, DEFAULT_LIMITS, type RiskLimits } from "@midas/exchange";

export interface TradingContext {
  client: OrderlyClient;
  enabled: boolean;
  limits: RiskLimits;
  network: string;
}

export function loadTrading(): TradingContext | null {
  const accountId = process.env.ORDERLY_ACCOUNT_ID;
  const orderlyKey = process.env.ORDERLY_KEY;
  const secretHex = process.env.ORDERLY_SECRET_HEX;
  const baseUrl = process.env.ORDERLY_BASE_URL || "https://testnet-api-evm.orderly.org";
  if (!accountId || !orderlyKey || !secretHex) return null;

  const limits: RiskLimits = {
    maxPositionSizeUsd: num("MIDAS_MAX_POSITION_USD", DEFAULT_LIMITS.maxPositionSizeUsd),
    maxLeverage: num("MIDAS_MAX_LEVERAGE", DEFAULT_LIMITS.maxLeverage),
    maxDailyLossUsd: num("MIDAS_MAX_DAILY_LOSS_USD", DEFAULT_LIMITS.maxDailyLossUsd),
    maxRiskPerTradePct: num("MIDAS_MAX_RISK_PCT", DEFAULT_LIMITS.maxRiskPerTradePct),
  };

  return {
    client: new OrderlyClient({ baseUrl, accountId, orderlyKey, secretHex }),
    enabled: process.env.MIDAS_TRADING_ENABLED === "true",
    limits,
    network: baseUrl.includes("testnet") ? "testnet" : "mainnet",
  };
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
