import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { deleteOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { agentId } = (await req.json().catch(() => ({}))) as any;
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  await deleteOrderly(s.userId, agentId);
  return NextResponse.json({ disconnected: true });
}
