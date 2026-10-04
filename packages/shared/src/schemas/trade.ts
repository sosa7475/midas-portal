import { z } from "zod";

/** Canonical order/trade statuses. Orderly statuses are mapped into this set server-side. */
export const TradeStatus = z.enum([
  "pending",
  "confirmed",
  "partial",
  "filled",
  "cancelled",
  "rejected",
]);
export type TradeStatus = z.infer<typeof TradeStatus>;

export const TradeSide = z.enum(["long", "short"]);
export type TradeSide = z.infer<typeof TradeSide>;

export const TradeRecommendation = z.object({
  pair: z.string(),
  side: TradeSide,
  entry: z.number().nullable(),
  size: z.number().nullable(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
});
export type TradeRecommendation = z.infer<typeof TradeRecommendation>;

export const ConfirmTradeRequest = z.object({
  pair: z.string().min(1).max(50),
  side: TradeSide,
  size: z.number().positive(),
  entry: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  strategyId: z.string().uuid().optional(),
  screenshotUrl: z.string().url().optional(),
  agentReasoning: z.string().max(4000).optional(),
  /** Client-supplied idempotency key: prevents double-submission on retry. */
  idempotencyKey: z.string().min(8).max(64),
});
export type ConfirmTradeRequest = z.infer<typeof ConfirmTradeRequest>;

export const Trade = z.object({
  id: z.string().uuid(),
  pair: z.string(),
  side: TradeSide,
  size: z.coerce.number(),
  entryPrice: z.coerce.number().nullable().optional(),
  stopLoss: z.coerce.number().nullable().optional(),
  takeProfit: z.coerce.number().nullable().optional(),
  orderId: z.string().nullable().optional(),
  status: TradeStatus,
  pnl: z.coerce.number().nullable().optional(),
  strategyName: z.string().nullable().optional(),
  agentReasoning: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Trade = z.infer<typeof Trade>;

export const TradeHistoryResponse = z.object({
  trades: z.array(Trade),
});
export type TradeHistoryResponse = z.infer<typeof TradeHistoryResponse>;
