/**
 * Robinhood Chain — official read-only feed for RH's tokenized-stock L2 (chain 4663).
 * Public, no key, 60 req/s. The authoritative source for the tokenized-stock universe,
 * live underlying quotes, and corporate actions. For ON-CHAIN DEX liquidity/OHLCV on
 * Robinhood Chain, pair this with GeckoTerminal (dex_analytics, network=robinhood).
 */
const BASE = "https://api.robinhood.com/rhj";
const num = (v: unknown): number | null => { if(v===null||v===undefined||v==="")return null;const n = Number(v); return Number.isFinite(n) ? n : null; };

async function rh(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Robinhood Chain ${r.status}`);
  return r.json();
}

export async function rhAssets(query?: string) {
  const d = await rh(`/assets/`);
  const list = (d.assets ?? []).map((a: any) => {
    const dep = a.deployments?.[0] ?? {};
    return { symbol: a.tokenSymbol, name: a.tokenName, contract: dep.contractAddress, chainId: dep.chainId,
      multiplier: num(a.currentMultiplier) ?? 1, status: String(a.status ?? "").replace("ASSET_STATUS_", ""), decimals: a.tokenDecimals, isin: a.isin };
  });
  if (query) {
    const q = query.trim().toUpperCase();
    const m = list.filter((x: any) => x.symbol?.toUpperCase().includes(q) || x.name?.replace(/\s*[•·]\s*Robinhood Token$/i, "").toUpperCase().includes(q));
    return { count: m.length, assets: m.slice(0, 25) };
  }
  return { total: list.length, note: `${list.length} tokenized stocks on Robinhood Chain. Pass query to filter, or kind=price for a live quote.`, sample: list.slice(0, 40) };
}

export async function rhPrice(symbol: string) {
  const s = (symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!s) return { error: "symbol required (e.g. AAPL, NVDA, TSLA)" };
  let d:any;try{d=await rh(`/prices/${s}`);}catch{return {available:false,symbol:s,error:"Robinhood price provider unavailable"};}
  const q = d?.quotes?.[0];
  if (!q) return { found: false, symbol: s, hint: "Not found on Robinhood Chain. Use kind=assets to search listed symbols." };
  const dep = q.deployments?.[0] ?? {};
  const bid = num(q.bid), ask = num(q.ask);
  return { found: true, symbol: q.tokenSymbol, bid, ask, mid: bid != null && ask != null ? Math.round(((bid + ask) / 2) * 100) / 100 : null,
    currency: q.currency, dailyVolume: num(q.dailyTradingVolume), isTradingHalt: !!q.isTradingHalt,
    contract: dep.contractAddress, chainId: dep.chainId, generatedAt: q.generatedAt,
    note: "Underlying share bid/ask (not multiplier-adjusted). For the on-chain token's DEX price/liquidity, call dex_analytics with network=robinhood and this contract." };
}

export async function rhCorporateActions(symbol?: string) {
  const d = await rh(`/corporate-actions`);
  let list = (d.corpActions ?? []).map((c: any) => ({
    symbol: c.tokenSymbol, type: String(c.type ?? "").replace("CORPORATE_ACTION_TYPE_", ""), status: String(c.status ?? "").replace("CORPORATE_ACTION_STATUS_", ""),
    date: c.processDate ? `${c.processDate.year}-${String(c.processDate.month).padStart(2, "0")}-${String(c.processDate.day).padStart(2, "0")}` : null,
  }));
  if (symbol) { const q = symbol.trim().toUpperCase(); list = list.filter((x: any) => x.symbol?.toUpperCase() === q); }
  return { count: list.length, corporateActions: list.slice(0, 25) };
}

export async function hoodChain(a: { kind: string; symbol?: string; query?: string }) {
  switch (a.kind) {
    case "assets": return rhAssets(a.query);
    case "price": return a.symbol ? rhPrice(a.symbol) : { error: "symbol required for kind=price" };
    case "corporate_actions": return rhCorporateActions(a.symbol);
    default: return { error: `unknown kind "${a.kind}". Valid: assets, price, corporate_actions.` };
  }
}
