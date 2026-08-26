import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";

const SECRET = process.env.JWT_SECRET || "";

export interface Session {
  userId: string;
  email: string;
}

export function signToken(s: Session): string {
  return jwt.sign(s, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" } as jwt.SignOptions);
}

/** Extract + verify the session from the Authorization header. Returns null if absent/invalid. */
export function getSession(req: NextRequest): Session | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const p = jwt.verify(header.slice(7), SECRET) as Session;
    return { userId: p.userId, email: p.email };
  } catch {
    return null;
  }
}
