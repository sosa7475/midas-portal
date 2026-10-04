import {NextRequest,NextResponse} from "next/server";
import {getSession} from "../../../lib/server/auth";
import {ownerRequest,recentOwnerRequest} from "../../../lib/server/owner-request";
import {assertAgentOwned} from "../../../lib/server/hl-sql";
import {createExitRule,listExitRules} from "../../../lib/server/spot-exits";
import {query} from "../../../lib/server/db";
export async function GET(req:NextRequest){
 const s=await getSession(req),id=req.nextUrl.searchParams.get("agentId")??"";
 if(!s||!await assertAgentOwned(s.userId,id))return NextResponse.json({error:"Unauthorized"},{status:401});
 return NextResponse.json({rules:await listExitRules({userId:s.userId,agentId:id})});
}
export async function POST(req:NextRequest){
 const s=await recentOwnerRequest(req);if(!s)return NextResponse.json({error:"Reauthenticate in Trading control to authorize an exit"},{status:403});
 try{const b=await req.json();if(!await assertAgentOwned(s.userId,b.agentId))throw Error("Agent not found");return NextResponse.json({rule:await createExitRule({userId:s.userId,agentId:b.agentId},b.rule)});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid rule"},{status:400});}
}
export async function DELETE(req:NextRequest){
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 const b=await req.json();await query("UPDATE spot_exit_rules SET status='revoked',updated_at=NOW() WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND status IN ('armed','executing','review_required')",[b.id,s.userId,b.agentId]);
 return NextResponse.json({revoked:true,note:"A transaction already broadcast cannot be recalled. Review the linked order."});
}
