import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "../../../lib/server/db";
import { getSession } from "../../../lib/server/auth";
import { ensureAgentsTable, rowToAgent } from "../../../lib/server/agents-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureAgentsTable();
  const r = await query("SELECT id, name, instructions, mcps, created_at FROM agents WHERE user_id = $1 ORDER BY created_at DESC", [s.userId]);
  return NextResponse.json({ agents: r.rows.map(rowToAgent) });
}

const Body = z.object({
  name: z.string().min(1).max(120),
  instructions: z.string().max(20000).default(""),
  mcps: z.array(z.string()).max(12).default([]),
});

export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Agent name is required" }, { status: 400 });
  await ensureAgentsTable();
  const { name, instructions, mcps } = parsed.data;
  const r = await query(
    "INSERT INTO agents (user_id, name, instructions, mcps) VALUES ($1,$2,$3,$4) RETURNING id, name, instructions, mcps, created_at",
    [s.userId, name, instructions, JSON.stringify(mcps)]
  );
  return NextResponse.json({ agent: rowToAgent(r.rows[0]) }, { status: 201 });
}
