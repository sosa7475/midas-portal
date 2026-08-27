import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { loadOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await loadOrderly(s.userId);
  if (!creds) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, network: creds.network, address: creds.address, accountId: creds.accountId });
}
