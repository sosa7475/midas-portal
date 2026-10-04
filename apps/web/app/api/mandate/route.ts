import {NextRequest,NextResponse} from "next/server";
import {getSession} from "../../../lib/server/auth";
import {ownerRequest,recentOwnerRequest} from "../../../lib/server/owner-request";
import {getMandate,mandateSchema} from "../../../lib/server/mandate";
import {query} from "../../../lib/server/db";
import {assertAgentOwned} from "../../../lib/server/hl-sql";
export async function GET(req:NextRequest) {
 const s=await getSession(req),id=req.nextUrl.searchParams.get("agentId")??"";
 if(!s||!await assertAgentOwned(s.userId,id))return NextResponse.json({error:"Unauthorized"},{status:401});
 return NextResponse.json({mandate:await getMandate(s.userId,id)});
}
export async function PUT(req:NextRequest) {
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 try{const b=await req.json();
 if(b.mandate?.enabled && !await recentOwnerRequest(req))return NextResponse.json({error:"Reauthenticate in Trading control to authorize trading"},{status:403});if(!await assertAgentOwned(s.userId,b.agentId))throw Error("Agent not found");
 const m=mandateSchema.parse(b.mandate);if(m.enabled&&Date.parse(m.expiresAt)<=Date.now())throw Error("Choose a future expiry");
 await query("INSERT INTO trading_mandates(user_id,agent_id,config) VALUES($1,$2,$3) ON CONFLICT(user_id,agent_id) DO UPDATE SET config=$3,updated_at=NOW()",[s.userId,b.agentId,JSON.stringify(m)]);
 return NextResponse.json({mandate:m});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid mandate"},{status:400});}
}
