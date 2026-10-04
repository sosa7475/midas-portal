import {NextRequest,NextResponse} from "next/server";
import bcrypt from "bcryptjs";
import {ownerRequest} from "../../../../lib/server/owner-request";
import {query} from "../../../../lib/server/db";
import {rateLimit} from "../../../../lib/server/ratelimit";
export async function POST(req:NextRequest){
 const s=await ownerRequest(req);if(!s)return NextResponse.json({error:"Sign in first"},{status:401});
 if(!await rateLimit(`reauth:${s.userId}`,5,600))return NextResponse.json({error:"Too many attempts; try again later"},{status:429});
 const b=await req.json();if(typeof b.password!=="string"||b.password.length>200)return NextResponse.json({error:"Password required"},{status:400});
 const row=(await query("SELECT password_hash FROM users WHERE id=$1",[s.userId])).rows[0];
 if(!row||!await bcrypt.compare(b.password,row.password_hash))return NextResponse.json({error:"Incorrect password"},{status:403});
 await query("UPDATE auth_sessions SET verified_at=NOW() WHERE id=$1 AND user_id=$2 AND expires_at>NOW()",[s.sessionId,s.userId]);
 return NextResponse.json({verified:true,validForSeconds:600});
}
