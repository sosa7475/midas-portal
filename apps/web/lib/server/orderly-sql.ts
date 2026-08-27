import { query } from "./db";
import { encrypt, decrypt } from "./crypto";
import type { OrderlyCreds } from "./orderly";

// Per-AGENT segregated trading accounts: each agent has its own isolated Orderly
// account/key/funds. No agent can touch another's — even within the same user.
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS agent_orderly_accounts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    orderly_key TEXT NOT NULL,
    secret_enc TEXT NOT NULL,
    address TEXT,
    base_url TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'testnet',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, agent_id)
  )`);
  ensured = true;
}

/** Verify the agent belongs to this user — the tenancy gate for every account op. */
export async function assertAgentOwned(userId: string, agentId: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return r.rows.length > 0;
}

export async function saveOrderly(userId: string, agentId: string, c: { accountId: string; orderlyKey: string; secretHex: string; address?: string; baseUrl: string }) {
  await ensure();
  const net = c.baseUrl.includes("testnet") ? "testnet" : "mainnet";
  await query(
    `INSERT INTO agent_orderly_accounts (user_id, agent_id, account_id, orderly_key, secret_enc, address, base_url, network)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, agent_id) DO UPDATE SET account_id=$3, orderly_key=$4, secret_enc=$5, address=$6, base_url=$7, network=$8`,
    [userId, agentId, c.accountId, c.orderlyKey, encrypt(c.secretHex), c.address ?? null, c.baseUrl, net]
  );
}

export async function loadOrderly(userId: string, agentId: string): Promise<(OrderlyCreds & { address?: string; network: string }) | null> {
  await ensure();
  const r = await query<any>("SELECT account_id, orderly_key, secret_enc, address, base_url, network FROM agent_orderly_accounts WHERE user_id = $1 AND agent_id = $2", [userId, agentId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return { accountId: row.account_id, orderlyKey: row.orderly_key, secretHex: decrypt(row.secret_enc), baseUrl: row.base_url, address: row.address, network: row.network };
}

export async function deleteOrderly(userId: string, agentId: string) {
  await ensure();
  await query("DELETE FROM agent_orderly_accounts WHERE user_id = $1 AND agent_id = $2", [userId, agentId]);
}

/** Public (non-secret) connection status for every agent the user owns. */
export async function listOrderlyStatuses(userId: string): Promise<Record<string, { connected: boolean; network?: string; address?: string; accountId?: string }>> {
  await ensure();
  const r = await query<any>("SELECT agent_id, network, address, account_id FROM agent_orderly_accounts WHERE user_id = $1", [userId]);
  const map: Record<string, any> = {};
  for (const row of r.rows) map[row.agent_id] = { connected: true, network: row.network, address: row.address, accountId: row.account_id };
  return map;
}
