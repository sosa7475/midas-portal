import { query } from "./db";
import { encrypt, decrypt } from "./crypto";

/**
 * Per-agent Turnkey keyset. We store the agent's DEDICATED, trade-only API private key
 * encrypted (AES-256-GCM) — and even if it leaked, the Turnkey policy limits it to
 * swaps on allow-listed routers (withdrawals denied in the enclave). Keys for the wallet
 * itself never leave Turnkey. One keyset covers EVM (Hood Chain/Base/Arb) + Solana.
 */
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS agent_turnkey_keyset (
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    sub_org_id TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    sol_address TEXT NOT NULL,
    agent_user_id TEXT NOT NULL,
    agent_api_public_key TEXT NOT NULL,
    agent_api_private_key_enc TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    routers JSONB NOT NULL DEFAULT '[]',
    owner_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, agent_id)
  )`);
  await query(`ALTER TABLE agent_turnkey_keyset ADD COLUMN IF NOT EXISTS owner_address TEXT`).catch(() => {});
  ensured = true;
}

/** The user's own address that withdrawals are allowed to return to. Owner-only, set once. */
export async function setOwnerAddress(userId: string, agentId: string, address: string) {
  await ensure();
  await query("UPDATE agent_turnkey_keyset SET owner_address=$3 WHERE user_id=$1 AND agent_id=$2", [userId, agentId, address.toLowerCase()]);
}

export async function assertAgentOwned(userId: string, agentId: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return r.rows.length > 0;
}

export interface KeysetPublic { subOrgId: string; evmAddress: string; solAddress: string; policyId: string; routers: string[]; ownerAddress: string | null }

export async function saveKeyset(userId: string, agentId: string, k: { subOrgId: string; evmAddress: string; solAddress: string; agentUserId: string; agentApiPublicKey: string; agentApiPrivateKey: string; policyId: string; routers: string[] }) {
  await ensure();
  await query(
    `INSERT INTO agent_turnkey_keyset (user_id, agent_id, sub_org_id, evm_address, sol_address, agent_user_id, agent_api_public_key, agent_api_private_key_enc, policy_id, routers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id, agent_id) DO NOTHING`,
    [userId, agentId, k.subOrgId, k.evmAddress, k.solAddress, k.agentUserId, k.agentApiPublicKey, encrypt(k.agentApiPrivateKey), k.policyId, JSON.stringify(k.routers)]
  );
}

/** Public info — never returns the private key. */
export async function loadKeysetPublic(userId: string, agentId: string): Promise<KeysetPublic | null> {
  await ensure();
  const r = await query<any>("SELECT sub_org_id, evm_address, sol_address, policy_id, routers, owner_address FROM agent_turnkey_keyset WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
  if (!r.rows.length) return null;
  const x = r.rows[0];
  return { subOrgId: x.sub_org_id, evmAddress: x.evm_address, solAddress: x.sol_address, policyId: x.policy_id, routers: x.routers ?? [], ownerAddress: x.owner_address ?? null };
}

/** Full signer creds incl. decrypted agent API key — server-side signing only. */
export async function loadKeysetSigner(userId: string, agentId: string) {
  await ensure();
  const r = await query<any>("SELECT sub_org_id, evm_address, sol_address, agent_api_public_key, agent_api_private_key_enc, policy_id FROM agent_turnkey_keyset WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
  if (!r.rows.length) return null;
  const x = r.rows[0];
  return { subOrgId: x.sub_org_id, evmAddress: x.evm_address, solAddress: x.sol_address, apiPublicKey: x.agent_api_public_key, apiPrivateKey: decrypt(x.agent_api_private_key_enc), policyId: x.policy_id };
}

export async function deleteKeyset(userId: string, agentId: string) {
  await ensure();
  await query("DELETE FROM agent_turnkey_keyset WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
}

export async function listKeysets(userId: string): Promise<Record<string, { evmAddress: string; solAddress: string }>> {
  await ensure();
  const r = await query<any>("SELECT agent_id, evm_address, sol_address FROM agent_turnkey_keyset WHERE user_id=$1", [userId]);
  const map: Record<string, any> = {};
  for (const row of r.rows) map[row.agent_id] = { evmAddress: row.evm_address, solAddress: row.sol_address };
  return map;
}
