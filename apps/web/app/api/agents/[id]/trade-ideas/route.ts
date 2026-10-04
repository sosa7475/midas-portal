import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/server/auth";
import { listTradeIdeas, rejectTradeIdea, claimTradeIdea, finishTradeIdea } from "../../../../../lib/server/trade-ideas";
import { query } from "../../../../../lib/server/db";
import { z } from "zod";
import { callTool } from "../../../../../lib/server/mcp-tools";
import { approveExecution } from "../../../../../lib/server/execution-orders";
export const runtime = "nodejs";
export const maxDuration = 120;
async function scope(req: NextRequest, id: string) {
  const s = await getSession(req);
  if (!s) return null;
  if (!z.string().uuid().safeParse(id).success) return null;
  const r = await query("SELECT 1 FROM agents WHERE user_id=$1 AND id=$2",[s.userId,id]);
  return r.rows.length ? s : null;
}
export async function GET(req: NextRequest, {params}: {params: Promise<{id:string}>}) {
  const {id}=await params;const s=await scope(req,id);
  if(!s)return NextResponse.json({error:"Unauthorized or agent not found"},{status:401});
  return NextResponse.json({ideas:await listTradeIdeas(s.userId,id)});
}
export async function DELETE(req: NextRequest, {params}: {params: Promise<{id:string}>}) {
  if(!req.cookies.get("midas_token")?.value || req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"Origin rejected"},{status:403});
  const {id}=await params;const s=await scope(req,id);
  if(!s)return NextResponse.json({error:"Unauthorized or agent not found"},{status:401});
  const b=await req.json();if(!z.string().uuid().safeParse(b.ideaId).success)return NextResponse.json({error:"Invalid idea"},{status:400});
  await rejectTradeIdea(s.userId,id,b.ideaId);return NextResponse.json({rejected:true});
}

/** Session-only human review endpoint; deliberately absent from the MCP tool surface. */
export async function POST(req: NextRequest, {params}: {params: Promise<{id:string}>}) {
  if(!req.cookies.get("midas_token")?.value || req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"Origin rejected"},{status:403});
  const {id}=await params;const s=await scope(req,id);
  if(!s)return NextResponse.json({error:"Unauthorized or agent not found"},{status:401});
  const b=await req.json();if(!z.string().uuid().safeParse(b.ideaId).success)return NextResponse.json({error:"Invalid idea"},{status:400});
  let claimed=false;
  try {
    const p=await claimTradeIdea(s.userId,id,b.ideaId);claimed=true;
    const ctx={userId:s.userId,agentId:id};
    const proposal=await callTool("propose_swap",{chain:p.chain??"base",tokenIn:p.tokenIn,tokenOut:p.tokenOut,amountIn:p.amountIn,slippagePct:p.slippagePct,minimumOutRaw:p.minimumOutRaw,validUntilMs:Date.parse(p.expiresAt),requestKey:`idea:${b.ideaId}`},ctx);
    await approveExecution(ctx,proposal.intent);
    const result=await callTool("execute_swap",{intent:proposal.intent},ctx);
    let persistenceWarning: string | undefined;
    await finishTradeIdea(s.userId,id,b.ideaId,result,result.placed===true).catch(()=>{persistenceWarning="Submission result could not be saved to the idea. Check transaction history; do not resubmit.";});
    return NextResponse.json({...result,persistenceWarning},{status:200});
  }catch(error){
    const result={placed:false,error:error instanceof Error?error.message:"Submission status unknown; check transaction history before retrying"};
    if(claimed)await finishTradeIdea(s.userId,id,b.ideaId,result,false).catch(()=>{});
    return NextResponse.json(result,{status:409});
  }
}
