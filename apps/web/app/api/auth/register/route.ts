import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../../../../lib/server/db";
import { signToken } from "../../../../lib/server/auth";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or password (min 8 chars)" }, { status: 400 });
  const { email, password, displayName } = parsed.data;
  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    const hash = await bcrypt.hash(password, 12);
    const r = await query<{ id: string; email: string; display_name: string | null }>(
      "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name",
      [email.toLowerCase(), hash, displayName ?? null]
    );
    const u = r.rows[0];
    const token = signToken({ userId: u.id, email: u.email });
    return NextResponse.json({ token, user: { id: u.id, email: u.email, displayName: u.display_name } }, { status: 201 });
  } catch (e) {
    console.error("register error", e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
