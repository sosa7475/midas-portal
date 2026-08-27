import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { deleteOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await deleteOrderly(s.userId);
  return NextResponse.json({ disconnected: true });
}
