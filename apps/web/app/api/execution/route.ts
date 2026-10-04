import {recoverApprovalOnly} from "../../../lib/server/order-recovery";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/server/auth";
import { ownerRequest,recentOwnerRequest } from "../../../lib/server/owner-request";
import { approveExecution, listExecutions } from "../../../lib/server/execution-orders";
import { callTool } from "../../../lib/server/mcp-tools";
import { assertAgentOwned } from "../../../lib/server/hl-sql";
import { query } from "../../../lib/server/db";
export const runtime="nodejs";
export const maxDuration=180;
export async function GET(req:NextRequest) {
 const s=await getSession(req),agentId=req.nextUrl.searchParams.get("agentId")??"";
 if(!s||!await assertAgentOwned(s.userId,agentId))return NextResponse.json({error:"Unauthorized"},{status:401});
 return NextResponse.json({orders:await listExecutions({userId:s.userId,agentId})});
}
export async function POST(req:NextRequest) {
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session and same origin required"},{status:403});
 try{
  const b=await req.json();if(!await assertAgentOwned(s.userId,b.agentId))throw new Error("Agent not found");
  const ctx={userId:s.userId,agentId:b.agentId};
  if(b.action==="recover"){if(!await recentOwnerRequest(req))throw Error("Reauthenticate in Trading control before recovery");return NextResponse.json(await recoverApprovalOnly(ctx,b.orderId));}
  if(b.action==="propose")return NextResponse.json(await callTool(b.kind==="swap"?"propose_swap":"propose_trade",b.terms,ctx));
  if(b.action==="reject") {await query("UPDATE execution_orders SET status='rejected' WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND status IN ('proposed','approved')",[b.orderId,s.userId,b.agentId]);return NextResponse.json({rejected:true});}
  if(b.action!=="approve")throw new Error("Unknown action");
  const rows=await listExecutions(ctx),order=rows.find(x=>x.id===b.orderId);if(!order)throw new Error("Order not found");
  await approveExecution(ctx,b.orderId);
  return NextResponse.json(await callTool(order.kind==="swap"?"execute_swap":order.kind==="trade"?"execute_trade":"execute_order",{intent:b.orderId},ctx));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Execution failed"},{status:409});}
}
