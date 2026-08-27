import { query } from "./db";
import { encrypt, decrypt } from "./crypto";
import type { OrderlyCreds } from "./orderly";

let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS orderly_accounts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    orderly_key TEXT NOT NULL,
    secret_enc TEXT NOT NULL,
    address TEXT,
    base_url TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'testnet',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  ensured = true;
}

export async function saveOrderly(userId: string, c: { accountId: string; orderlyKey: string; secretHex: string; address?: string; baseUrl: string }) {
  await ensure();
  const net = c.baseUrl.includes("testnet") ? "testnet" : "mainnet";
  await query(
    `INSERT INTO orderly_accounts (user_id, account_id, orderly_key, secret_enc, address, base_url, network)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET account_id=$2, orderly_key=$3, secret_enc=$4, address=$5, base_url=$6, network=$7`,
    [userId, c.accountId, c.orderlyKey, encrypt(c.secretHex), c.address ?? null, c.baseUrl, net]
  );
}

export async function loadOrderly(userId: string): Promise<(OrderlyCreds & { address?: string; network: string }) | null> {
  await ensure();
  const r = await query<any>("SELECT account_id, orderly_key, secret_enc, address, base_url, network FROM orderly_accounts WHERE user_id = $1", [userId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return { accountId: row.account_id, orderlyKey: row.orderly_key, secretHex: decrypt(row.secret_enc), baseUrl: row.base_url, address: row.address, network: row.network };
}

export async function deleteOrderly(userId: string) {
  await ensure();
  await query("DELETE FROM orderly_accounts WHERE user_id = $1", [userId]);
}
