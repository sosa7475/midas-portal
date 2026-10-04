import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../../../../lib/server/db";
import { signToken, setAuthCookie } from "../../../../lib/server/auth";
import { rateLimit, clientIp } from "../../../../lib/server/ratelimit";
import { passwordIssue } from "../../../../lib/server/password";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  // Signup throttle: 5 / 10 min per IP.
  if (!(await rateLimit(`reg:${ip}`, 5, 600))) {
    return NextResponse.json({ error: "Too many signups from this network. Try again later." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid email and password are required" }, { status: 400 });
  const { email, password, displayName } = parsed.data;

  const pwIssue = passwordIssue(password);
  if (pwIssue) return NextResponse.json({ error: pwIssue }, { status: 400 });

  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return NextResponse.json({ error: "Could not create account with those details" }, { status: 409 });
    const hash = await bcrypt.hash(password, 12);
    const r = await query<{ id: string; email: string; display_name: string | null }>(
      "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name",
      [email.toLowerCase(), hash, displayName ?? null]
    );
    const u = r.rows[0];
    const token = await signToken({ userId: u.id, email: u.email });
    const res = NextResponse.json({ user: { id: u.id, email: u.email, displayName: u.display_name } }, { status: 201 });
    setAuthCookie(res, token);
    return res;
  } catch (e) {
    console.error("register error", e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
