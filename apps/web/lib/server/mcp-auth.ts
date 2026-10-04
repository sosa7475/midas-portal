import {DEFAULT_SCOPES,scopesSchema} from "./mcp-permissions";
import { createHash, randomBytes } from "crypto";
import { query,transaction } from "./db";

/**
 * Connector tokens — let a user link ONE agent to an external AI client (Claude, ChatGPT)
 * via MCP. The token is scoped to (user, agent); only its SHA-256 hash is stored.
 */
let ensured = false;
export async function ensureMcpTokens() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS mcp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
  )`);
  await query("ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ");
  await query("UPDATE mcp_tokens SET expires_at=NOW()+INTERVAL '7 days' WHERE expires_at IS NULL");
  await query("ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '[\"read\",\"research\",\"propose\"]'");
  await query("ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS family_id UUID");
  ensured = true;
}
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createMcpToken(userId: string, agentId: string, label = "AI connector", scopes:string[]=DEFAULT_SCOPES): Promise<string> {
  scopes=scopesSchema.parse(scopes);
  await ensureMcpTokens();
  const token = "igk_" + randomBytes(24).toString("hex");
  await query("INSERT INTO mcp_tokens (token_hash, user_id, agent_id, label,expires_at,scopes) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 days',$5)", [hash(token), userId, agentId, label,JSON.stringify(scopes)]);
  return token; // shown once
}

export async function resolveMcpToken(token: string): Promise<{ userId: string; agentId: string; connectorId:string;scopes:string[] } | null> {
  if (!token || !token.startsWith("igk_")) return null;
  await ensureMcpTokens();
  const r = await query<any>("SELECT id,user_id, agent_id, scopes FROM mcp_tokens WHERE token_hash = $1 AND expires_at>NOW() AND EXISTS (SELECT 1 FROM agents WHERE agents.id=mcp_tokens.agent_id AND agents.user_id=mcp_tokens.user_id)", [hash(token)]);
  if (!r.rows.length) return null;
  query("UPDATE mcp_tokens SET last_used_at = NOW() WHERE token_hash = $1 AND expires_at>NOW() AND EXISTS (SELECT 1 FROM agents WHERE agents.id=mcp_tokens.agent_id AND agents.user_id=mcp_tokens.user_id)", [hash(token)]).catch(() => {});
  return { userId: r.rows[0].user_id, agentId: r.rows[0].agent_id,connectorId:r.rows[0].id,scopes:scopesSchema.parse(r.rows[0].scopes) };
}

export async function listMcpTokens(userId: string, agentId: string) {
  await ensureMcpTokens();
  const r = await query<any>("SELECT id, label, created_at, last_used_at, expires_at, scopes FROM mcp_tokens WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC", [userId, agentId]);
  return r.rows;
}
export async function revokeMcpToken(userId:string,id:string){
 await ensureMcpTokens();
 await transaction(async tx=>{
  const row=await tx.query("SELECT family_id FROM mcp_tokens WHERE user_id=$1 AND id=$2",[userId,id]);
  const family=row.rows[0]?.family_id;
  if(family){await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",["oauth:"+family]);await tx.query("UPDATE oauth_grants SET revoked_at=NOW() WHERE user_id=$1 AND family_id=$2",[userId,family]);await tx.query("DELETE FROM mcp_tokens WHERE user_id=$1 AND family_id=$2",[userId,family]);}
  else await tx.query("DELETE FROM mcp_tokens WHERE user_id=$1 AND id=$2",[userId,id]);
 });
}
