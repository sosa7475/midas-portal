import {NextResponse} from "next/server";
import {query} from "../../../../lib/server/db";
export const dynamic="force-dynamic";
export async function GET(){
 try{const r=await query("SELECT name FROM worker_health WHERE heartbeat_at>NOW()-INTERVAL '90 seconds'");const healthy=["execution-monitor","reconciliation-monitor","research-worker"].every(n=>r.rows.some(x=>x.name===n));return NextResponse.json({healthy},{status:healthy?200:503,headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({healthy:false},{status:503});}
}
