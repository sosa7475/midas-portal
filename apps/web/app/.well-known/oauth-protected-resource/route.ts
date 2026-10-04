import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// RFC 9728 — tells MCP clients which authorization server protects /api/mcp.
export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin;
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
}
