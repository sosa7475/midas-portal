import { z } from "zod";
import { TradeRecommendation } from "./trade.js";

export const ParsedRules = z.object({
  entryConditions: z.array(z.string()).optional(),
  riskPerTrade: z.string().optional(),
  positionSizing: z.string().optional(),
  stopLossRule: z.string().optional(),
  takeProfitRule: z.string().optional(),
  filters: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type ParsedRules = z.infer<typeof ParsedRules>;

export const DefineStrategyRequest = z.object({
  rulesText: z.string().min(10).max(10000),
  name: z.string().min(1).max(100).optional(),
});
export type DefineStrategyRequest = z.infer<typeof DefineStrategyRequest>;

export const Strategy = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rulesText: z.string(),
  parsedRulesJson: ParsedRules.nullable().optional(),
  createdAt: z.string(),
});
export type Strategy = z.infer<typeof Strategy>;

export const TradeIdeaRequest = z.object({
  idea: z.string().min(1).max(4000),
});
export type TradeIdeaRequest = z.infer<typeof TradeIdeaRequest>;

export const AgentResponse = z.object({
  content: z.string(),
  tradeRecommendation: TradeRecommendation.nullable(),
});
export type AgentResponse = z.infer<typeof AgentResponse>;
