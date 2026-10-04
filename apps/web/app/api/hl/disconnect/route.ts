import {NextRequest,NextResponse} from "next/server";
import {ownerRequest} from "../../../../lib/server/owner-request";
import {query} from "../../../../lib/server/db";
export async function POST(req:NextRequest){
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Owner session required"},{status:403});
 const b=await req.json();if(typeof b.agentId!=="string")return NextResponse.json({error:"Agent required"},{status:400});
 await query("UPDATE hl_connections_v2 SET disabled=TRUE WHERE user_id=$1 AND agent_id=$2",[s.userId,b.agentId]);
 return NextResponse.json({disconnected:true,note:"Local trading disabled. Revoke the API wallet in Hyperliquid too. Historical wallet keys are preserved."});
}
