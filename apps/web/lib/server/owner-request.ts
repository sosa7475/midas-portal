import type { NextRequest } from "next/server";
import { getSession, COOKIE } from "./auth";
export async function ownerRequest(req:NextRequest) {
 if(!req.cookies.get(COOKIE)?.value || req.headers.get("origin")!==new URL(req.url).origin)return null;
 return await getSession(req);
}

export async function recentOwnerRequest(req:NextRequest){
 const s=await ownerRequest(req);return s&&Number.isFinite(s.verifiedAt)&&Date.now()-s.verifiedAt!<=10*60000?s:null;
}
