import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../../lib/server/db";
import { getSession } from "../../../../lib/server/auth";
import { ensureAgentsTable, rowToAgent } from "../../../../lib/server/agents-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureAgentsTable();
  const { id } = await params;
  const r = await query("SELECT id, name, instructions, mcps, created_at FROM agents WHERE id = $1 AND user_id = $2", [id, s.userId]);
  if (!r.rows.length) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ agent: rowToAgent(r.rows[0]) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await query("DELETE FROM agents WHERE id = $1 AND user_id = $2", [id, s.userId]);
  return NextResponse.json({ deleted: true });
}
