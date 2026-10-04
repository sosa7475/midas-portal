import {NextRequest,NextResponse} from "next/server";
import {recentOwnerRequest} from "../../../../lib/server/owner-request";
import {assertAgentOwned} from "../../../../lib/server/hl-sql";
import {verifyApiWallet} from "../../../../lib/server/hyperliquid";
import {privateKeyToAccount} from "viem/accounts";
import {isAddress} from "viem";
import {encrypt} from "../../../../lib/server/crypto";
import {query} from "../../../../lib/server/db";
export const runtime="nodejs";
export async function POST(req:NextRequest) {
 const s=await recentOwnerRequest(req);if(!s)return NextResponse.json({error:"Reauthenticate in Trading control before connecting a signer"},{status:403});
 try {
  const b=await req.json();if(!await assertAgentOwned(s.userId,b.agentId))throw Error("Agent not found");
  if(!isAddress(b.ownerAddress??"")||!/^0x[0-9a-f]{64}$/i.test(b.agentPrivateKey??""))throw Error("Provide the account address and its approved trade-only API wallet key in Trading control. Never use the owner wallet key.");
  if(!["mainnet","testnet"].includes(b.network))throw Error("Select mainnet or testnet");
  const network=b.network==="mainnet"?"mainnet":"testnet";
  const signer=privateKeyToAccount(b.agentPrivateKey).address;
  await verifyApiWallet(b.ownerAddress,signer,network);
  const existing=await query("SELECT owner_address,signer_address,network FROM hl_connections_v2 WHERE user_id=$1 AND agent_id=$2",[s.userId,b.agentId]);
  if(existing.rows.length) {
   const e=existing.rows[0];if(e.owner_address.toLowerCase()!==b.ownerAddress.toLowerCase()||e.signer_address.toLowerCase()!==signer.toLowerCase()||e.network!==network)throw Error("Existing connection preserved; revoke and archive it before replacing credentials");
   await query("UPDATE hl_connections_v2 SET disabled=FALSE WHERE user_id=$1 AND agent_id=$2",[s.userId,b.agentId]);
   return NextResponse.json({connected:true,address:e.owner_address,signerAddress:e.signer_address,network});
  }
  const inserted=await query("INSERT INTO hl_connections_v2(user_id,agent_id,owner_address,signer_address,secret_enc,network) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING owner_address",[s.userId,b.agentId,b.ownerAddress,signer,encrypt(b.agentPrivateKey),network]);
  if(!inserted.rows.length)throw Error("Connection changed concurrently; reload before continuing");
  return NextResponse.json({connected:true,address:b.ownerAddress,signerAddress:signer,network});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Connection failed"},{status:400});}
}
