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
    CREATE TABLE IF NOT EXISTS agent_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      tools JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages ON agent_messages(user_id, agent_id, created_at);
  `);
  ensured = true;
}

export interface StoredMessage { role: "user" | "assistant"; content: string; tools?: any }

/** Load recent conversation for an agent, oldest-first. */
export async function loadAgentMessages(userId: string, agentId: string, limit = 30): Promise<StoredMessage[]> {
  const r = await query<{ role: "user" | "assistant"; content: string; tools: any }>(
    "SELECT role, content, tools FROM agent_messages WHERE user_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3",
    [userId, agentId, limit]
  );
  return r.rows.reverse().map((m) => ({ role: m.role, content: m.content, tools: m.tools ?? undefined }));
}

export async function saveAgentMessage(userId: string, agentId: string, role: "user" | "assistant", content: string, tools?: any) {
  await query(
    "INSERT INTO agent_messages (user_id, agent_id, role, content, tools) VALUES ($1,$2,$3,$4,$5)",
    [userId, agentId, role, content, tools ? JSON.stringify(tools) : null]
  );
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
