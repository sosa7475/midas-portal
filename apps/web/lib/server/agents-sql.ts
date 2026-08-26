import { query } from "./db";

let ensured = false;

/** Idempotent table bootstrap — runs on first agents API hit so no separate migration step. */
export async function ensureAgentsTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      mcps JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
  `);
  ensured = true;
}

export interface AgentRow {
  id: string;
  name: string;
  instructions: string;
  mcps: string[];
  created_at: string;
}

export function rowToAgent(r: any): AgentRow {
  return {
    id: r.id,
    name: r.name,
    instructions: r.instructions,
    mcps: r.mcps ?? [],
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}
