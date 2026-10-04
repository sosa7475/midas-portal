import {randomUUID} from "node:crypto";
import {query} from "./db";
import jwt from "jsonwebtoken";
import type { NextRequest, NextResponse } from "next/server";

const ISSUER = "midas";
const AUDIENCE = "midas:session";
export function sessionSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  return secret;
}
export const COOKIE = "midas_token";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface Session {
  userId: string;
  email: string;
  sessionId?:string;
  verifiedAt?:number;
}

export async function signToken(s: Session): Promise<string> {
  const id=randomUUID();
  await query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[id,s.userId]);
  return jwt.sign({ ...s, t: "session",jti:id }, sessionSecret(), { algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, expiresIn: process.env.JWT_EXPIRES_IN || "7d" } as jwt.SignOptions);
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
export async function getSession(req: NextRequest): Promise<Session | null> {
  const fromCookie = req.cookies.get(COOKIE)?.value;
  const header = req.headers.get("authorization");
  const token = fromCookie || (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return null;
  try {
    const p = jwt.verify(token, sessionSecret(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE }) as Session & {t?: string;jti?:string};
    if (p.t !== "session" || typeof p.userId !== "string" || typeof p.email !== "string") return null;
    if(!p.jti)return null;
    const row=await query("SELECT verified_at FROM auth_sessions WHERE id=$1 AND user_id=$2 AND expires_at>NOW()",[p.jti,p.userId]);
    if(!row.rows.length)return null;
    return { userId: p.userId, email: p.email,sessionId:p.jti,verifiedAt:new Date(row.rows[0].verified_at).getTime() };
  } catch {
    return null;
  }
}

export async function revokeSession(req:NextRequest){
 const token=req.cookies.get(COOKIE)?.value;if(!token)return;
 try{const p=jwt.verify(token,sessionSecret(),{algorithms:["HS256"],issuer:ISSUER,audience:AUDIENCE}) as any;
 if(p.t==="session"&&p.jti)await query("DELETE FROM auth_sessions WHERE id=$1 AND user_id=$2",[p.jti,p.userId]);
 }catch{}
}
