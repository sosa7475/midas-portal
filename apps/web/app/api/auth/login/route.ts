import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../../../../lib/server/db";
import { signToken, setAuthCookie } from "../../../../lib/server/auth";
import { rateLimit, clientIp } from "../../../../lib/server/ratelimit";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const { email, password } = parsed.data;

  // Brute-force protection: per-IP (20/10min) and per-account (6/10min).
  const [ipOk, acctOk] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 20, 600),
    rateLimit(`login:acct:${email.toLowerCase()}`, 6, 600),
  ]);
  if (!ipOk || !acctOk) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  try {
    const r = await query<{ id: string; email: string; password_hash: string; display_name: string | null }>(
      "SELECT id, email, password_hash, display_name FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (!r.rows.length) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const u = r.rows[0];
    if (!(await bcrypt.compare(password, u.password_hash))) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const token = await signToken({ userId: u.id, email: u.email });
    const res = NextResponse.json({ user: { id: u.id, email: u.email, displayName: u.display_name } });
    setAuthCookie(res, token);
    return res;
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
