import { NextResponse } from "next/server";
import { clearAuthCookie } from "../../../../lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
