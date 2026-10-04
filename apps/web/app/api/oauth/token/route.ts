import {exchangeGrant} from "../../../../lib/server/oauth-grants";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import { createMcpToken } from "../../../../lib/server/mcp-auth";

export const runtime = "nodejs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const err = (e: string, code = 400) => NextResponse.json({ error: e }, { status: code, headers: CORS });

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

async function params(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await req.json().catch(() => ({}))) as any;
  const body = await req.text();
  return Object.fromEntries(new URLSearchParams(body));
}
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// OAuth 2.1 token endpoint: authorization_code (+PKCE) and refresh_token grants.
// The access token is a Midas MCP connector token, so /api/mcp validates it unchanged.
export async function POST(req: NextRequest) {
 try{return NextResponse.json(await exchangeGrant(await params(req)),{headers:CORS});}
 catch{return err("invalid_grant");}
}
