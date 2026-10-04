import { Router } from "express";
import { ConfirmTradeRequest } from "@midas/shared";
import { query } from "../db";
import { authenticate, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import * as orderly from "../services/orderly";
import { getUserOrderlyCreds } from "./wallet";

const router = Router();
router.use(authenticate);

/**
 * Confirm and execute a trade. Idempotent: retries with the same idempotencyKey
 * return the original trade instead of double-placing the order.
 * PHASE 3 adds the server-side risk-engine gate here, before placeOrder.
 */
router.post("/confirm", validateBody(ConfirmTradeRequest), async (req, res) => {
  const p = req.body as ConfirmTradeRequest;
  const userId = (req as AuthedRequest).user.userId;

  try {
    // Idempotency check BEFORE hitting the exchange.
    const existing = await query(
      "SELECT * FROM trades WHERE user_id = $1 AND idempotency_key = $2",
      [userId, p.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      return res.json({ trade: rowToTrade(existing.rows[0]), idempotent: true });
    }

    const creds = await getUserOrderlyCreds(userId);
    if (!creds) {
      return res.status(400).json({ error: "No Orderly credentials. Connect your wallet first." });
    }

    const execution = await orderly.placeOrder({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      pair: p.pair,
      side: p.side,
      size: p.size,
      orderType: p.orderType,
      price: p.entry ?? null,
      stopLoss: p.stopLoss ?? null,
      takeProfit: p.takeProfit ?? null,
    });

    // execution.status is already mapped into the canonical set — no CHECK violation.
    const result = await query(
      `INSERT INTO trades (user_id, strategy_id, pair, side, size, entry_price, stop_loss,
                           take_profit, order_id, status, screenshot_url, agent_reasoning, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        userId,
        p.strategyId ?? null,
        p.pair,
        p.side,
        p.size,
        p.entry ?? null,
        p.stopLoss ?? null,
        p.takeProfit ?? null,
        execution.orderId,
        execution.status,
        p.screenshotUrl ?? null,
        p.agentReasoning ?? null,
        p.idempotencyKey,
      ]
    );

    res.json({ trade: rowToTrade(result.rows[0]), execution });
  } catch (err) {
    console.error("Trade execution error:", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Trade execution failed",
    });
  }
});

router.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  try {
    const result = await query(
      `SELECT t.*, s.name AS strategy_name FROM trades t
       LEFT JOIN strategies s ON t.strategy_id = s.id
       WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
      [(req as AuthedRequest).user.userId, limit, offset]
    );
    res.json({ trades: result.rows.map(rowToTrade) });
  } catch (err) {
    console.error("Trade history error:", err);
    res.status(500).json({ error: "Failed to fetch trade history" });
  }
});

router.get("/:tradeId", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).user.userId;
  try {
    const result = await query("SELECT * FROM trades WHERE id = $1 AND user_id = $2", [
      req.params.tradeId,
      userId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Trade not found" });

    const row = result.rows[0];

    // Refresh non-terminal orders from Orderly (best-effort).
    if (row.order_id && (row.status === "confirmed" || row.status === "partial")) {
      try {
        const creds = await getUserOrderlyCreds(userId);
        if (creds) {
          const orderStatus = await orderly.getOrderStatus(
            creds.apiKey,
            creds.apiSecret,
            row.order_id
          );
          const mapped = orderly.mapOrderlyStatus(orderStatus?.status);
          if (mapped !== row.status) {
            await query("UPDATE trades SET status = $1, updated_at = NOW() WHERE id = $2", [
              mapped,
              row.id,
            ]);
            row.status = mapped;
          }
        }
      } catch {
        // Non-fatal; return cached status.
      }
    }

    res.json({ trade: rowToTrade(row) });
  } catch (err) {
    console.error("Trade fetch error:", err);
    res.status(500).json({ error: "Failed to fetch trade" });
  }
});

function rowToTrade(row: Record<string, any>) {
  return {
    id: row.id,
    pair: row.pair,
    side: row.side,
    size: row.size,
    entryPrice: row.entry_price,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    orderId: row.order_id,
    status: row.status,
    pnl: row.pnl,
    strategyName: row.strategy_name ?? null,
    agentReasoning: row.agent_reasoning ?? null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export default router;
