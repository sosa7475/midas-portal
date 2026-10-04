import {NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {MCP_TOOLS} from "../../../../lib/server/mcp-tools";
export async function GET(){return NextResponse.json({version:"2.0.0",toolCount:MCP_TOOLS.length,catalogHash:createHash("sha256").update(JSON.stringify(MCP_TOOLS)).digest("hex"),tools:MCP_TOOLS,authentication:"OAuth or Authorization bearer token; no credentials in URLs",note:"tools/list returns the subset allowed by your connector permissions. Refresh/reconnect clients caching an older schema."},{headers:{"Cache-Control":"no-store"}});}
