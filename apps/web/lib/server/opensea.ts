/**
 * OpenSea MCP bridge — proxies to OpenSea's hosted MCP server (mcp.opensea.io)
 * over Streamable HTTP (initialize → initialized → tools/call), parsing the SSE
 * reply. Activates when OPENSEA_API_KEY is set (free instant key or opensea.io
 * developer settings).
 */
const MCP = "https://mcp.opensea.io/mcp";
const KEY = process.env.OPENSEA_API_KEY;

export function openseaReady(): boolean {
  return !!KEY;
}

function baseHeaders(): Record<string, string> {
  return {
    "X-API-KEY": KEY as string,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
}

/** Parse an SSE / JSON body and return the first JSON-RPC object that has a result/error. */
function parseRpc(text: string): any {
  const objs: any[] = [];
  for (const line of text.split("\n")) {
    const t = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!t || !t.startsWith("{")) continue;
    try { objs.push(JSON.parse(t)); } catch {}
  }
  return objs.find((o) => o.result !== undefined || o.error !== undefined) ?? objs[0];
}

/** Call one OpenSea MCP tool. Returns the tool's structured/text result. */
export async function openseaMcp(tool: string, args: Record<string, unknown>): Promise<any> {
  if (!KEY) return { connected: false, note: "OpenSea is not connected. Add an OPENSEA_API_KEY to enable NFT data." };

  // 1. initialize (get a session id)
  const init = await fetch(MCP, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "midas", version: "1.0" } } }),
    signal: AbortSignal.timeout(20_000),
  });
  const sid = init.headers.get("mcp-session-id");
  const h = { ...baseHeaders(), ...(sid ? { "mcp-session-id": sid } : {}) };

  // 2. initialized notification
  await fetch(MCP, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).catch(() => {});

  // 3. tools/call
  const res = await fetch(MCP, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(25_000),
  });
  const rpc = parseRpc(await res.text());
  if (rpc?.error) return { error: rpc.error.message || "OpenSea error" };
  const result = rpc?.result;
  if (result?.structuredContent) return result.structuredContent;
  const textPart = result?.content?.find((c: any) => c.type === "text")?.text;
  if (textPart) { try { return JSON.parse(textPart); } catch { return { text: textPart }; } }
  return result ?? { error: "no result" };
}

// Curated tool surface for the agent.
export function openseaSearch(query: string) { return openseaMcp("search", { query }); }
export function openseaCollection(collection: string) { return openseaMcp("get_collection", { collection, includes: ["stats", "floor_prices"] }); }
export function openseaTrending(timeframe = "ONE_DAY") { return openseaMcp("get_trending_collections", { timeframe }); }
export function openseaWallet(address: string) { return openseaMcp("get_nft_balances", { address }); }
