import {ownerRequest} from "../../../../../lib/server/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/server/auth";
import { getRisk, setRisk, type RiskConfig } from "../../../../../lib/server/agent-risk-sql";
import { query } from "../../../../../lib/server/db";

export const runtime = "nodejs";

async function owns(userId: string, agentId: string) {
  const r = await query("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2", [agentId, userId]);
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owns(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ config: await getRisk(s.userId, id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await ownerRequest(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owns(s.userId, id))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as any;

  // Coerce: null/empty = "no limit"; numbers clamped to sane bounds; paused is the kill switch.
  const num = (v: any, max: number) => (v === null || v === "" || v === undefined ? null : Math.min(Math.max(Number(v), 0), max));
  for (const key of ["maxNotionalUsd","maxLeverage","maxRiskPerTradePct","maxTradesPerDay","dailyLossLimitUsd"]) {
    if (key in b && b[key] !== null && b[key] !== "" && (!Number.isFinite(Number(b[key])) || Number(b[key]) < 0)) return NextResponse.json({error:`Invalid ${key}`},{status:400});
  }
  for (const key of ["paused","autoExecute"]) if (key in b && typeof b[key] !== "boolean") return NextResponse.json({error:`Invalid ${key}`},{status:400});
  const patch: Partial<RiskConfig> = {};
  if ("paused" in b) patch.paused = !!b.paused;
  if ("autoExecute" in b) patch.autoExecute = !!b.autoExecute;
  if ("maxNotionalUsd" in b) patch.maxNotionalUsd = num(b.maxNotionalUsd, 10_000_000);
  if ("maxLeverage" in b) patch.maxLeverage = num(b.maxLeverage, 50);
  if ("maxRiskPerTradePct" in b) patch.maxRiskPerTradePct = num(b.maxRiskPerTradePct, 100);
  if ("maxTradesPerDay" in b) patch.maxTradesPerDay = num(b.maxTradesPerDay, 100_000);
  if ("dailyLossLimitUsd" in b) patch.dailyLossLimitUsd = num(b.dailyLossLimitUsd, 10_000_000);
  return NextResponse.json({ config: await setRisk(s.userId, id, patch) });
}
