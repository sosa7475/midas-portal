import {scopesSchema,DEFAULT_SCOPES} from "../../../../lib/server/mcp-permissions";
import { NextRequest, NextResponse } from "next/server";
import {issueCode} from "../../../../lib/server/oauth-grants";
import {ownerRequest} from "../../../../lib/server/owner-request";
import { getSession } from "../../../../lib/server/auth";
import { getClient } from "../../../../lib/server/oauth-sql";
import { query } from "../../../../lib/server/db";

export const runtime = "nodejs";


// Session-gated: the logged-in Midas user consents and picks which agent to connect.
// Mints a short-lived authorization code (JWT) bound to user+agent+client+PKCE challenge.
export async function POST(req: NextRequest) {
  const s = await ownerRequest(req);
  if (!s) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as any;
  const { client_id, redirect_uri, code_challenge, agentId, state } = b;
  if (!client_id || !redirect_uri || !code_challenge || !agentId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const client = await getClient(client_id);
  if (!client) return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  if (!client.redirectUris.includes(redirect_uri)) return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  const owned = await query("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2", [agentId, s.userId]);
  if (!owned.rows.length) return NextResponse.json({ error: "invalid_agent" }, { status: 400 });

  if(!/^[A-Za-z0-9_-]{43}$/.test(code_challenge))return NextResponse.json({error:"invalid_code_challenge"},{status:400});
  const scopes=scopesSchema.safeParse(b.scopes??DEFAULT_SCOPES);if(!scopes.success)return NextResponse.json({error:"invalid_scope"},{status:400});
  const code = await issueCode({ userId: s.userId, agentId, client_id, redirect_uri, cc: code_challenge,scopes:scopes.data });
  const u = new URL(redirect_uri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  return NextResponse.json({ redirect: u.toString() });
}
