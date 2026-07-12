import { Router } from "express";
import { ChatMessageRequest } from "@midas/shared";
import { query } from "../db";
import { authenticate, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { processMessage } from "../agent";
import { getUserLlmKey } from "./settings";

const router = Router();
router.use(authenticate);

router.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  try {
    const result = await query(
      `SELECT id, role, content, metadata, created_at FROM conversations
       WHERE user_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [(req as AuthedRequest).user.userId, limit]
    );
    res.json({
      messages: result.rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tradeRecommendation: m.metadata?.tradeRecommendation ?? null,
        createdAt: m.created_at,
      })),
    });
  } catch (err) {
    console.error("Chat history error:", err);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

/**
 * Streaming chat — real token-by-token SSE (native on Fly's persistent process).
 * Events: {type:'delta',content} per token, then {type:'message',...} with the
 * final assembled content + parsed trade recommendation, then [DONE].
 */
router.post("/message", validateBody(ChatMessageRequest), async (req, res) => {
  const { message } = req.body as ChatMessageRequest;
  const userId = (req as AuthedRequest).user.userId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const userKey = await getUserLlmKey(userId);
    const result = await processMessage({
      userId,
      userMessage: message,
      userApiKey: userKey?.apiKey ?? null,
      userProvider: userKey?.provider ?? null,
      onDelta: (delta) => send({ type: "delta", content: delta }),
    });

    send({
      type: "message",
      content: result.content,
      tradeRecommendation: result.tradeRecommendation,
    });
    res.write("data: [DONE]\n\n");
  } catch (err) {
    console.error("Chat error:", err);
    send({ type: "error", error: err instanceof Error ? err.message : "Chat failed" });
  } finally {
    res.end();
  }
});

export default router;
