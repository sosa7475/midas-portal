import { query, transaction } from "./db";

/**
 * Per-agent living strategy: a versioned, hybrid doc (prose thesis + runnable spec) the
 * agent reads and writes, plus a performance ledger. Changes are either proposed for
 * human approval or auto-promoted when a challenger beats the champion out-of-sample —
 * controlled by the agent's auto_promote flag.
 */
let ensured = false;
export async function ensureStrategyTables() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS agent_strategy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    version INT NOT NULL,
    thesis TEXT NOT NULL DEFAULT '',
    spec JSONB,
    rationale TEXT NOT NULL DEFAULT '',
    metrics JSONB,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS agent_perf (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    strategy_version INT,
    kind TEXT NOT NULL,
    metrics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_promote BOOLEAN NOT NULL DEFAULT FALSE`);
  ensured = true;
}

export interface StrategyRow { version: number; thesis: string; spec: any; rationale: string; metrics: any; status: string; created_at: string }

export async function getActiveStrategy(userId: string, agentId: string): Promise<StrategyRow | null> {
  await ensureStrategyTables();
  const r = await query<any>("SELECT version, thesis, spec, rationale, metrics, status, created_at FROM agent_strategy WHERE user_id=$1 AND agent_id=$2 AND status='active' ORDER BY version DESC LIMIT 1", [userId, agentId]);
  return r.rows[0] ?? null;
}

export async function getStrategyVersion(userId: string, agentId: string, version: number): Promise<StrategyRow | null> {
  await ensureStrategyTables();
  const r = await query<any>("SELECT version, thesis, spec, rationale, metrics, status, created_at FROM agent_strategy WHERE user_id=$1 AND agent_id=$2 AND version=$3", [userId, agentId, version]);
  return r.rows[0] ?? null;
}

export async function listVersions(userId: string, agentId: string): Promise<StrategyRow[]> {
  await ensureStrategyTables();
  const r = await query<any>("SELECT version, thesis, spec, rationale, metrics, status, created_at FROM agent_strategy WHERE user_id=$1 AND agent_id=$2 ORDER BY version DESC LIMIT 25", [userId, agentId]);
  return r.rows;
}

async function nextVersion(userId: string, agentId: string): Promise<number> {
  const r = await query<any>("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_strategy WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
  return r.rows[0].n;
}

/** Insert a new version. status='active' archives prior active; 'proposed' waits for approval. */
export async function addVersion(userId: string, agentId: string, v: { thesis: string; spec: any; rationale: string; metrics: any; status: "active" | "proposed" }): Promise<number> {
  await ensureStrategyTables();
  return transaction(async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${userId}:${agentId}:strategy`]);
    const version=(await tx.query("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_strategy WHERE user_id=$1 AND agent_id=$2",[userId,agentId])).rows[0].n;
    if(v.status==="active")await tx.query("UPDATE agent_strategy SET status='archived' WHERE user_id=$1 AND agent_id=$2 AND status='active'",[userId,agentId]);
    await tx.query("INSERT INTO agent_strategy(user_id,agent_id,version,thesis,spec,rationale,metrics,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[userId,agentId,version,v.thesis,JSON.stringify(v.spec),v.rationale,JSON.stringify(v.metrics),v.status]);
    return version;
  });
}

/** Promote a proposed version to active (archives the current active). */
export async function activateVersion(userId: string, agentId: string, version: number): Promise<boolean> {
  await ensureStrategyTables();
  return transaction(async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${userId}:${agentId}:strategy`]);
    const r=await tx.query("SELECT 1 FROM agent_strategy WHERE user_id=$1 AND agent_id=$2 AND version=$3",[userId,agentId,version]);
    if(!r.rows.length)return false;
    await tx.query("UPDATE agent_strategy SET status='archived' WHERE user_id=$1 AND agent_id=$2 AND status='active'",[userId,agentId]);
    await tx.query("UPDATE agent_strategy SET status='active' WHERE user_id=$1 AND agent_id=$2 AND version=$3",[userId,agentId,version]);return true;
  });
}

export async function getAutoPromote(userId: string, agentId: string): Promise<boolean> {
  await ensureStrategyTables();
  const r = await query<any>("SELECT auto_promote FROM agents WHERE id=$1 AND user_id=$2", [agentId, userId]);
  return !!r.rows[0]?.auto_promote;
}
export async function setAutoPromote(userId: string, agentId: string, on: boolean) {
  await ensureStrategyTables();
  await query("UPDATE agents SET auto_promote=$3 WHERE id=$1 AND user_id=$2", [agentId, userId, on]);
}

export async function logPerf(userId: string, agentId: string, version: number | null, kind: string, metrics: any) {
  await ensureStrategyTables();
  await query("INSERT INTO agent_perf (user_id, agent_id, strategy_version, kind, metrics) VALUES ($1,$2,$3,$4,$5)", [userId, agentId, version, kind, JSON.stringify(metrics)]);
}
export async function getPerf(userId: string, agentId: string, limit = 20) {
  await ensureStrategyTables();
  const r = await query<any>("SELECT strategy_version, kind, metrics, created_at FROM agent_perf WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT $3", [userId, agentId, limit]);
  return r.rows;
}

/** Trade-only history prevents backtest records from hiding recent broadcasts. */
export async function getTradePerf(userId: string, agentId: string, limit = 20) {
  await ensureStrategyTables();
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const r = await query<any>("SELECT strategy_version, kind, metrics, created_at FROM agent_perf WHERE user_id=$1 AND agent_id=$2 AND kind='trade' ORDER BY created_at DESC LIMIT $3", [userId, agentId, bounded]);
  return r.rows;
}
