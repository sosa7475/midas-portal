import {NextRequest,NextResponse} from "next/server";
import {query} from "../../../lib/server/db";
import {ownerRequest} from "../../../lib/server/owner-request";
import {getSession} from "../../../lib/server/auth";
import {assertAgentOwned} from "../../../lib/server/hl-sql";
export async function GET(req:NextRequest) {
 const s=await getSession(req),id=req.nextUrl.searchParams.get("agentId")??"";
 if(!s||!await assertAgentOwned(s.userId,id))return NextResponse.json({error:"Unauthorized"},{status:401});
 const runs=await query("SELECT id,status,started_at,finished_at,result->>'summary' AS summary,error FROM agent_runs WHERE user_id=$1 AND agent_id=$2 ORDER BY started_at DESC LIMIT 20",[s.userId,id]);
 const schedule=await query("SELECT enabled,interval_seconds,next_run_at FROM agent_schedules WHERE user_id=$1 AND agent_id=$2",[s.userId,id]);
 return NextResponse.json({runs:runs.rows,schedule:schedule.rows[0]??null});
}
export async function PUT(req:NextRequest) {
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 const b=await req.json();if(typeof b.enabled!=="boolean"||!Number.isInteger(b.intervalSeconds)||b.intervalSeconds<60||b.intervalSeconds>86400||!await assertAgentOwned(s.userId,b.agentId))return NextResponse.json({error:"Invalid schedule"},{status:400});
 await query("INSERT INTO agent_schedules(user_id,agent_id,enabled,interval_seconds) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,agent_id) DO UPDATE SET enabled=$3,interval_seconds=$4",[s.userId,b.agentId,b.enabled,b.intervalSeconds]);
 return NextResponse.json({saved:true});
}
