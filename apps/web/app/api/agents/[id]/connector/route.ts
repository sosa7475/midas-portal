import {ownerRequest} from "../../../../../lib/server/owner-request";
import {scopesSchema,DEFAULT_SCOPES} from "../../../../../lib/server/mcp-permissions";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/server/auth";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "../../../../../lib/server/mcp-auth";
import { query } from "../../../../../lib/server/db";

export const runtime = "nodejs";

async function owns(userId: string, agentId: string) {
  const r = await query("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2", [agentId, userId]);
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(req); if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owns(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ tokens: await listMcpTokens(s.userId, id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await ownerRequest(req); if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owns(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const { label,scopes } = (await req.json().catch(() => ({}))) as any;
  const token = await createMcpToken(s.userId, id, label || "AI connector",scopesSchema.parse(scopes??DEFAULT_SCOPES));
  const base = req.nextUrl.origin;
  return NextResponse.json({ token, url: `${base}/api/mcp`, authentication:"Authorization: Bearer <token>" });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await ownerRequest(req); if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tokenId = req.nextUrl.searchParams.get("tokenId");
  if (!tokenId) return NextResponse.json({ error: "tokenId required" }, { status: 400 });
  await revokeMcpToken(s.userId, tokenId);
  return NextResponse.json({ revoked: true });
}
