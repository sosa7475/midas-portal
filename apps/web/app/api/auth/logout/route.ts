import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookie,revokeSession } from "../../../../lib/server/auth";

export const runtime = "nodejs";

export async function POST(req:NextRequest) {
  await revokeSession(req);
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
