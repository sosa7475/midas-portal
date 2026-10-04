import {NextRequest,NextResponse} from "next/server";
import {getSession} from "../../../lib/server/auth";
import {venueCapabilities,chainWallet} from "../../../lib/server/venues";
import {assertAgentOwned} from "../../../lib/server/hl-sql";
export async function GET(req:NextRequest) {
 const s=await getSession(req);if(!s)return NextResponse.json({error:"Unauthorized"},{status:401});
 const agentId=req.nextUrl.searchParams.get("agentId");
 if(!agentId)return NextResponse.json(venueCapabilities());
 if(!await assertAgentOwned(s.userId,agentId))return NextResponse.json({error:"Agent not found"},{status:404});
 try{return NextResponse.json(await chainWallet({userId:s.userId,agentId},req.nextUrl.searchParams.get("chain")||"base"));}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Wallet unavailable"},{status:503});}
}
