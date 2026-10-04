import {ownerRequest} from "../../../../../lib/server/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/server/auth";
import { getActiveStrategy, listVersions, getAutoPromote, setAutoPromote, activateVersion, getPerf } from "../../../../../lib/server/strategy-sql";

export const runtime = "nodejs";

async function assertOwned(userId: string, agentId: string) {
  const { query } = await import("../../../../../lib/server/db");
  const r = await query("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2", [agentId, userId]);
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await assertOwned(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const [active, versions, autoPromote, performance] = await Promise.all([
    getActiveStrategy(s.userId, id), listVersions(s.userId, id), getAutoPromote(s.userId, id), getPerf(s.userId, id, 20),
  ]);
  return NextResponse.json({ active, versions, autoPromote, performance });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await ownerRequest(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await assertOwned(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as any;

  if (b.action === "approve" && typeof b.version === "number") {
    const ok = await activateVersion(s.userId, id, b.version);
    return NextResponse.json({ approved: ok, version: b.version });
  }
  if (b.action === "autoPromote" && typeof b.on === "boolean") {
    await setAutoPromote(s.userId, id, b.on);
    return NextResponse.json({ autoPromote: b.on });
  }
  return NextResponse.json({ error: "Unknown action. Use { action: 'approve', version } or { action: 'autoPromote', on }." }, { status: 400 });
}
