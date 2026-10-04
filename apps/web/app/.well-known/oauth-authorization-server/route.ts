import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// RFC 8414 — OAuth 2.1 authorization-server metadata for the MCP connector.
export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin;
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });
}
