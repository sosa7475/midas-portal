import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { listOrderlyStatuses } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

// Connection status for every agent this user owns (non-secret).
export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ statuses: await listOrderlyStatuses(s.userId) });
}
