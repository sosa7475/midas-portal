import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/server/auth";
import { ensureAgentsTable, loadAgentMessages } from "../../../../../lib/server/agents-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureAgentsTable();
  const { id } = await params;
  const messages = await loadAgentMessages(s.userId, id, 100);
  return NextResponse.json({ messages });
}
