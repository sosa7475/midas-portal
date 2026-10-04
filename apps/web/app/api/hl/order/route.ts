import {NextRequest,NextResponse} from "next/server";
import {ownerRequest} from "../../../../lib/server/owner-request";
import {callTool} from "../../../../lib/server/mcp-tools";
import {assertAgentOwned} from "../../../../lib/server/hl-sql";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(req:NextRequest) {
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 try{const b=await req.json();if(!await assertAgentOwned(s.userId,b.agentId))throw Error("Agent not found");
 const result=await callTool("propose_trade",b,{userId:s.userId,agentId:b.agentId});
 return NextResponse.json({...result,placed:false,requiresReview:true,reviewUrl:"/trading?agentId="+b.agentId,note:"Review and approve the stored order in Trading control."});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Proposal failed"},{status:400});}
}
