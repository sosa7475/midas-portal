import {verifyApiWallet} from "./hyperliquid";
import { query } from "./db";
import { encrypt, decrypt } from "./crypto";

// Per-AGENT segregated Hyperliquid accounts: each agent has its own agent-wallet
// key (encrypted), isolated funds/keys. Reads need only the address (no key).
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS agent_hl_accounts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    privkey_enc TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'testnet',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, agent_id)
  )`);
  ensured = true;
}

export async function assertAgentOwned(userId: string, agentId: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
  return r.rows.length > 0;
}

export async function saveHl(userId: string, agentId: string, c: { address: string; privateKey: string; network: string }) {
  await ensure();
  await query(
    `INSERT INTO agent_hl_accounts (user_id, agent_id, address, privkey_enc, network) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, agent_id) DO NOTHING`,
    [userId, agentId, c.address, encrypt(c.privateKey), c.network]
  );
}

/** Public info (address + network) — never returns the key. */
export async function loadHlPublic(userId: string, agentId: string): Promise<{ address: string; network: "testnet" | "mainnet";tradingEnabled?:boolean } | null> {
  const verified=await query<any>("SELECT owner_address,network,disabled FROM hl_connections_v2 WHERE user_id=$1 AND agent_id=$2",[userId,agentId]);
  if(verified.rows.length)return {address:verified.rows[0].owner_address,network:verified.rows[0].network,tradingEnabled:!verified.rows[0].disabled};
  await ensure();
  const r = await query<any>("SELECT address, network FROM agent_hl_accounts WHERE user_id = $1 AND agent_id = $2", [userId, agentId]);
  return r.rows.length ? { address: r.rows[0].address, network: r.rows[0].network,tradingEnabled:false } : null;
}

/** Full creds incl. decrypted key — only for signing on the server. */
export async function loadHlSigner(userId: string, agentId: string): Promise<{ address: string; privateKey: `0x${string}`; network: "testnet" | "mainnet";tradingEnabled?:boolean } | null> {
  const r=await query<any>("SELECT * FROM hl_connections_v2 WHERE user_id=$1 AND agent_id=$2 AND disabled=FALSE",[userId,agentId]);
  if(!r.rows.length)return null;
  const c=r.rows[0];await verifyApiWallet(c.owner_address,c.signer_address,c.network);
  return {address:c.owner_address,privateKey:decrypt(c.secret_enc) as `0x${string}`,network:c.network};
}

export async function deleteHl(userId: string, agentId: string) {
  await ensure();
  throw new Error("Disconnect requires verified venue revocation and recovery; account keys have been preserved");
}

export async function listHl(userId: string): Promise<Record<string, { connected: boolean; network: string; address: string }>> {
  await ensure();
  const r = await query<any>("SELECT agent_id, address, network FROM agent_hl_accounts WHERE user_id = $1", [userId]);
  const map: Record<string, any> = {};
  for (const row of r.rows) map[row.agent_id] = { connected: true, network: row.network, address: row.address };
  const verified=await query("SELECT agent_id,owner_address,network,disabled FROM hl_connections_v2 WHERE user_id=$1",[userId]);
  for(const row of verified.rows)map[row.agent_id]={connected:!row.disabled,address:row.owner_address,network:row.network};
  return map;
}
