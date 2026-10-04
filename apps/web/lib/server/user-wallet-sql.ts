import { query } from "./db";

/** One personal spending wallet per user (Midas Bank). Turnkey-secured; user-controlled sends. */
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS user_wallet (
    user_id UUID PRIMARY KEY,
    sub_org_id TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    sol_address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  ensured = true;
}

export interface UserWallet { subOrgId: string; evmAddress: string; solAddress: string }

export async function loadUserWallet(userId: string): Promise<UserWallet | null> {
  await ensure();
  const r = await query<any>("SELECT sub_org_id, evm_address, sol_address FROM user_wallet WHERE user_id=$1", [userId]);
  if (!r.rows.length) return null;
  return { subOrgId: r.rows[0].sub_org_id, evmAddress: r.rows[0].evm_address, solAddress: r.rows[0].sol_address };
}

export async function saveUserWallet(userId: string, w: UserWallet) {
  await ensure();
  await query(
    `INSERT INTO user_wallet (user_id, sub_org_id, evm_address, sol_address) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, w.subOrgId, w.evmAddress, w.solAddress]
  );
}
