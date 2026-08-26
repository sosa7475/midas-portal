import jwt from "jsonwebtoken";
import type { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.JWT_SECRET || "";
export const COOKIE = "midas_token";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface Session {
  userId: string;
  email: string;
}

export function signToken(s: Session): string {
  return jwt.sign(s, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" } as jwt.SignOptions);
}

/** Set the token as an httpOnly, secure, sameSite cookie (not readable by JS → XSS-safe). */
export function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Read the session from the httpOnly cookie (or Authorization header fallback for API tools). */
export function getSession(req: NextRequest): Session | null {
  const fromCookie = req.cookies.get(COOKIE)?.value;
  const header = req.headers.get("authorization");
  const token = fromCookie || (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET) as Session;
    return { userId: p.userId, email: p.email };
  } catch {
    return null;
  }
}
