import { NextRequest, NextResponse } from "next/server";
import { registerClient } from "../../../../lib/server/oauth-sql";

export const runtime = "nodejs";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

// RFC 7591 dynamic client registration — public PKCE clients (no secret).
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as any;
  const redirectUris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!redirectUris.length) return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400, headers: CORS });
  if(redirectUris.length>10 || redirectUris.some(u=>{try{const p=new URL(u);return p.protocol!=="https:" && !(p.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(p.hostname));}catch{return true;}}))return NextResponse.json({error:"invalid_redirect_uri"},{status:400});
  const { clientId } = await registerClient(redirectUris, b.client_name);
  return NextResponse.json({
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: b.client_name ?? undefined,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201, headers: CORS });
}
