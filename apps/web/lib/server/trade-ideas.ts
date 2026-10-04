import { createHash } from "node:crypto";
import { z } from "zod";
import { query } from "./db";
import { quoteSwap, resolveToken, getDecimals, CHAINS } from "./dex";
import { swapOutput } from "../swap-output";
import { formatUnits } from "viem";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/).max(80).refine(v => Number(v) > 0 && Number.isFinite(Number(v)));
export const tradeIdeaInput = z.object({
  chain:z.enum(["base","robinhood"]).default("base"),
  ideaKey: z.string().min(1).max(120),
  tokenIn: z.string().min(1).max(42), tokenOut: z.string().min(1).max(42),
  amountIn: decimal, slippageBps: z.number().int().min(0).max(300),
  strategyVersion: z.string().min(1).max(120), rationale: z.string().min(10).max(2000),
  exitPlan: z.string().min(10).max(2000), invalidation: z.string().min(10).max(2000),
  evidence: z.string().min(10).max(4000),
}).strict();
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS agent_trade_ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, agent_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review', idea_key TEXT NOT NULL, input_digest TEXT NOT NULL, proposal JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL,
    result JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,agent_id,idea_key)
  )`);
  ensured = true;
}
/** Store an advisory proposal only. This module never loads a signer or submits an order. */
export async function publishTradeIdea(userId: string, agentId: string, input: unknown) {
  const p = tradeIdeaInput.parse(input);
  await ensure();
  const inputDigest = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const existing = await query("SELECT id,status,proposal,expires_at,input_digest FROM agent_trade_ideas WHERE user_id=$1 AND agent_id=$2 AND idea_key=$3",[userId,agentId,p.ideaKey]);
  if(existing.rows.length) {
    if(existing.rows[0].input_digest !== inputDigest) throw new Error("Idea key reused with different terms");
    const {input_digest,...row}=existing.rows[0];return {...row,duplicate:true,submitted:false};
  }
  const tin = resolveToken(p.chain, p.tokenIn), tout = resolveToken(p.chain, p.tokenOut);
  const nativeIn = p.tokenIn.trim().toLowerCase() === "eth";
  const [decIn, decOut] = await Promise.all([nativeIn ? 18 : getDecimals(p.chain, tin), getDecimals(p.chain, tout)]);
  const q = await quoteSwap(p.chain, tin, tout, p.amountIn, decIn, decOut);
  const minimum = q.amountOutRaw - q.amountOutRaw * BigInt(p.slippageBps) / 10000n;
  const expiresAt = new Date(Date.now() + 3 * 60_000).toISOString();
  const proposal = { ...p, chain: p.chain, ...swapOutput(p.tokenOut, tout, CHAINS[p.chain].wnative),
    tokenIn: nativeIn ? "eth" : tin, tokenOut: tout, amountIn: p.amountIn,
    tokenInAddress: tin, tokenOutAddress: tout, buy: q.amountOut, minOut: formatUnits(minimum, decOut),
    minimumOutRaw: minimum.toString(), feeTier: q.fee, slippagePct: p.slippageBps / 100,
    quoteBlock: q.blockNumber, expiresAt, deliveryMode: "human_review_only",
    costNote: "Quote includes pool fees. Network and approval fees are extra; profitability is not verified.",
  };
  await ensure();
  const r = await query(`INSERT INTO agent_trade_ideas (user_id,agent_id,proposal,expires_at,idea_key,input_digest)
    SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM agents WHERE user_id=$1 AND id=$2)
    ON CONFLICT (user_id,agent_id,idea_key) DO NOTHING
    RETURNING id,status,created_at,expires_at,proposal`, [userId,agentId,JSON.stringify(proposal),expiresAt,p.ideaKey,inputDigest]);
  if (!r.rows.length) throw new Error("Agent not found or concurrent duplicate; retry with the same idea key");
  return { ...r.rows[0], submitted: false, note: "Saved for human review in Midas. No intent or transaction was submitted; automatic-execution settings do not consume this queue." };
}
export async function listTradeIdeas(userId: string, agentId: string) {
  await ensure();
  return (await query(`SELECT id, CASE WHEN status='pending_review' AND expires_at<=NOW() THEN 'expired' ELSE status END AS status,
    proposal,created_at,expires_at,result FROM agent_trade_ideas WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 20`, [userId,agentId])).rows;
}
/** One atomic claim per idea. A timeout cannot re-open it for a duplicate submission. */
export async function claimTradeIdea(userId: string, agentId: string, id: string) {
  await ensure();
  const r = await query(`UPDATE agent_trade_ideas SET status='submission_started',updated_at=NOW()
    WHERE user_id=$1 AND agent_id=$2 AND id=$3 AND status='pending_review' AND expires_at>NOW()
    RETURNING proposal`, [userId,agentId,id]);
  if (!r.rows.length) throw new Error("Idea expired or already handled; refresh the queue");
  return r.rows[0].proposal;
}
export async function finishTradeIdea(userId: string, agentId: string, id: string, result: unknown, submitted: boolean) {
  await query(`UPDATE agent_trade_ideas SET status=$4,result=$5,updated_at=NOW() WHERE user_id=$1 AND agent_id=$2 AND id=$3 AND status='submission_started'`,
    [userId,agentId,id,submitted ? "submitted" : "review_required",JSON.stringify(result)]);
}
export async function rejectTradeIdea(userId: string, agentId: string, id: string) {
  await ensure();
  await query(`UPDATE agent_trade_ideas SET status='rejected',updated_at=NOW() WHERE user_id=$1 AND agent_id=$2 AND id=$3 AND status='pending_review'`,[userId,agentId,id]);
}
