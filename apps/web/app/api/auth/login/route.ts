import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../../../../lib/server/db";
import { signToken } from "../../../../lib/server/auth";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const { email, password } = parsed.data;
  try {
    const r = await query<{ id: string; email: string; password_hash: string; display_name: string | null }>(
      "SELECT id, email, password_hash, display_name FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (!r.rows.length) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const u = r.rows[0];
    if (!(await bcrypt.compare(password, u.password_hash))) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const token = signToken({ userId: u.id, email: u.email });
    return NextResponse.json({ token, user: { id: u.id, email: u.email, displayName: u.display_name } });
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
