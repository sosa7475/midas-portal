import {createHash,createHmac,randomBytes,randomUUID} from "node:crypto";
import jwt from "jsonwebtoken";
import {sessionSecret} from "./auth";
import {query,transaction} from "./db";
import {ensureMcpTokens} from "./mcp-auth";
import {DEFAULT_SCOPES,scopesSchema} from "./mcp-permissions";
const secret=()=>createHmac("sha256",sessionSecret()).update("midas:oauth:v2").digest("hex");
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export async function issueCode(claims:Record<string,unknown>){
 const scopes=scopesSchema.parse(claims.scopes??DEFAULT_SCOPES);
 const code=jwt.sign({...claims,t:"oauthcode",jti:randomUUID()},secret(),{expiresIn:"5m",audience:"midas:oauth",issuer:"midas",algorithm:"HS256"});
 await query("INSERT INTO oauth_grants(token_hash,kind,user_id,agent_id,client_id,expires_at,scopes) VALUES($1,'code',$2,$3,$4,NOW()+INTERVAL '5 minutes',$5)",[hash(code),claims.userId,claims.agentId,claims.client_id,JSON.stringify(scopes)]);
 return code;
}
export async function exchangeGrant(p:Record<string,string>){
 await ensureMcpTokens();let raw:string,kind:string;
 if(p.grant_type==="authorization_code"){
  raw=p.code;kind="code";
  const c=jwt.verify(raw,secret(),{audience:"midas:oauth",issuer:"midas",algorithms:["HS256"]}) as any;
  if(c.t!=="oauthcode"||!p.client_id||p.client_id!==c.client_id||!p.redirect_uri||p.redirect_uri!==c.redirect_uri||!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier??"")||hashChallenge(p.code_verifier)!==c.cc)throw Error("invalid_grant");
 }else if(p.grant_type==="refresh_token"){raw=p.refresh_token;kind="refresh";}else throw Error("unsupported_grant_type");
 if(!raw||!p.client_id)throw Error("invalid_grant");
 const result=await transaction(async tx=>{
  const family=(await tx.query("SELECT family_id FROM oauth_grants WHERE token_hash=$1 AND kind=$2 AND client_id=$3",[hash(raw),kind,p.client_id])).rows[0];
  if(!family)return null;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",["oauth:"+family.family_id]);
  const r=await tx.query("SELECT * FROM oauth_grants WHERE token_hash=$1 AND kind=$2 AND client_id=$3 FOR UPDATE",[hash(raw),kind,p.client_id]);
  const g=r.rows[0];if(!g)return null;
  if(g.consumed_at||g.revoked_at){
   // Commit family revocation before reporting replay. Throwing here would roll it back.
   await tx.query("UPDATE oauth_grants SET revoked_at=NOW() WHERE family_id=$1",[g.family_id]);
   await tx.query("DELETE FROM mcp_tokens WHERE family_id=$1",[g.family_id]);return null;
  }
  if(new Date(g.expires_at).getTime()<=Date.now())return null;
  if(!(await tx.query("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2",[g.agent_id,g.user_id])).rows.length)return null;
  await tx.query("UPDATE oauth_grants SET consumed_at=NOW() WHERE token_hash=$1",[g.token_hash]);
  const access="igk_"+randomBytes(24).toString("hex"),refresh="igr_"+randomBytes(32).toString("hex");
  const scopes=scopesSchema.parse(g.scopes);
  await tx.query("INSERT INTO mcp_tokens(token_hash,user_id,agent_id,label,expires_at,scopes,family_id) VALUES($1,$2,$3,'OAuth connector',NOW()+INTERVAL '1 hour',$4,$5)",[hash(access),g.user_id,g.agent_id,JSON.stringify(scopes),g.family_id]);
  await tx.query("INSERT INTO oauth_grants(token_hash,kind,user_id,agent_id,client_id,expires_at,family_id,scopes) VALUES($1,'refresh',$2,$3,$4,NOW()+INTERVAL '30 days',$5,$6)",[hash(refresh),g.user_id,g.agent_id,g.client_id,g.family_id,JSON.stringify(scopes)]);
  return {access_token:access,refresh_token:refresh,token_type:"Bearer",expires_in:3600,scope:scopes.join(" ")};
 });
 if(!result)throw Error("invalid_grant");return result;
}
export const hashChallenge=(s:string)=>createHash("sha256").update(s).digest("base64url");
