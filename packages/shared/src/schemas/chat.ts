import { z } from "zod";
import { TradeRecommendation } from "./trade.js";

export const ChatMessageRequest = z.object({
  message: z.string().min(1).max(8000),
});
export type ChatMessageRequest = z.infer<typeof ChatMessageRequest>;

export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  tradeRecommendation: TradeRecommendation.nullable().optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatHistoryResponse = z.object({
  messages: z.array(ChatMessage),
});
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponse>;

/** SSE events emitted by POST /chat/message. */
export const ChatStreamEvent = z.discriminatedUnion("type", [
  /** A streamed token delta. */
  z.object({ type: z.literal("delta"), content: z.string() }),
  /** Final message with the fully assembled content + any parsed recommendation. */
  z.object({
    type: z.literal("message"),
    content: z.string(),
    tradeRecommendation: TradeRecommendation.nullable(),
  }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>;
