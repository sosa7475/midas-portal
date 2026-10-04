import {NextRequest,NextResponse} from "next/server";
import {getSession} from "../../../lib/server/auth";
import {ownerRequest} from "../../../lib/server/owner-request";
import {assertAgentOwned} from "../../../lib/server/hl-sql";
import {getReadiness} from "../../../lib/server/readiness";
import {query} from "../../../lib/server/db";
export async function GET(req:NextRequest){
 const s=await getSession(req),id=req.nextUrl.searchParams.get("agentId")??"";
 if(!s||!await assertAgentOwned(s.userId,id))return NextResponse.json({error:"Unauthorized"},{status:401});
 return NextResponse.json(await getReadiness({userId:s.userId,agentId:id}));
}
export async function POST(req:NextRequest){
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 const b=await req.json();await query("UPDATE operational_alerts SET acknowledged_at=NOW() WHERE id=$1 AND user_id=$2",[b.id,s.userId]);return NextResponse.json({acknowledged:true});
}
