import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query,transaction } from "../../../../lib/server/db";

export const runtime = "nodejs";

// Key-gated account maintenance (recovery). Requires ADMIN_KEY env + matching x-admin-key header.
// Used to fix a mistyped signup email and/or reset a password when a user is locked out.
function authed(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  const given = req.headers.get("x-admin-key") || "";
  if (!key || key.length < 16) return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Read-only lookup to find an account when the exact email is unknown (recovery aid).
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = req.nextUrl.searchParams.get("list");
  if (!q) return NextResponse.json({ error: "pass ?list=<substring>" }, { status: 400 });
  const r = await query<any>("SELECT email, created_at, (SELECT COUNT(*)::int FROM agents WHERE user_id=users.id) AS agents FROM users WHERE email ILIKE $1 ORDER BY created_at LIMIT 25", [`%${q}%`]);
  return NextResponse.json({ matches: r.rows });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { email, newEmail, newPassword } = (await req.json().catch(() => ({}))) as any;
  if (!email) return NextResponse.json({ error: "email (current) required" }, { status: 400 });

  const u = await query<any>("SELECT id, email FROM users WHERE email=$1", [String(email).toLowerCase()]);
  if (!u.rows.length) return NextResponse.json({ error: "No user with that email" }, { status: 404 });
  const userId = u.rows[0].id;
  const done: any = { userId, wasEmail: u.rows[0].email };

  if (newPassword) {
    if (String(newPassword).length < 8) return NextResponse.json({ error: "newPassword too short" }, { status: 400 });
    const hash=await bcrypt.hash(String(newPassword),12);
    await transaction(async tx=>{
     await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hash,userId]);
     await tx.query("DELETE FROM auth_sessions WHERE user_id=$1",[userId]);
     await tx.query("DELETE FROM mcp_tokens WHERE user_id=$1",[userId]);
     await tx.query("UPDATE oauth_grants SET revoked_at=NOW() WHERE user_id=$1",[userId]);
    });
    done.passwordReset = true;
  }
  if (newEmail) {
    const ne = String(newEmail).toLowerCase();
    const clash = await query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [ne, userId]);
    if (clash.rows.length) return NextResponse.json({ ...done, error: `Email ${ne} already in use — password reset applied, email unchanged.` }, { status: 200 });
    await query("UPDATE users SET email=$1 WHERE id=$2", [ne, userId]);
    done.email = ne;
  }
  return NextResponse.json({ ok: true, ...done });
}
