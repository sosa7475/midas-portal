import { randomBytes } from "crypto";
import { query } from "./db";

/** OAuth 2.1 dynamic-client-registration store for the MCP connector (public PKCE clients). */
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    redirect_uris JSONB NOT NULL DEFAULT '[]',
    client_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  ensured = true;
}

export async function registerClient(redirectUris: string[], name?: string) {
  await ensure();
  const clientId = "mcpc_" + randomBytes(16).toString("hex");
  await query("INSERT INTO oauth_clients (client_id, redirect_uris, client_name) VALUES ($1,$2,$3)", [clientId, JSON.stringify(redirectUris), name ?? null]);
  return { clientId, redirectUris };
}

export async function getClient(clientId: string): Promise<{ clientId: string; redirectUris: string[]; name: string | null } | null> {
  await ensure();
  const r = await query<any>("SELECT client_id, redirect_uris, client_name FROM oauth_clients WHERE client_id=$1", [clientId]);
  if (!r.rows.length) return null;
  return { clientId: r.rows[0].client_id, redirectUris: r.rows[0].redirect_uris ?? [], name: r.rows[0].client_name };
}
