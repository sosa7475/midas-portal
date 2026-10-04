import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "../../../lib/server/db";
import { getSession } from "../../../lib/server/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await query<any>(
    "SELECT id, name, rules_text, created_at FROM strategies WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1",
    [s.userId]
  );
  const row = r.rows[0];
  return NextResponse.json({ strategy: row ? { id: row.id, name: row.name, rulesText: row.rules_text, createdAt: row.created_at } : null });
}

const Body = z.object({ rulesText: z.string().min(10).max(10000), name: z.string().max(100).optional() });

export async function POST(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Strategy rules required (min 10 chars)" }, { status: 400 });
  await query("UPDATE strategies SET is_active = false WHERE user_id = $1", [s.userId]);
  const r = await query<any>(
    "INSERT INTO strategies (user_id, name, rules_text) VALUES ($1,$2,$3) RETURNING id, name, rules_text, created_at",
    [s.userId, parsed.data.name ?? "My Strategy", parsed.data.rulesText]
  );
  const row = r.rows[0];
  return NextResponse.json({ strategy: { id: row.id, name: row.name, rulesText: row.rules_text, createdAt: row.created_at } });
}
