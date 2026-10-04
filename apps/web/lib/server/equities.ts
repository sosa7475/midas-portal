import {rhPrice} from "./robinhood";
/**
 * Finnhub — underlying US equity truth (real share quote, company profile, fundamentals).
 * Used to value tokenized stocks vs. the real share (premium/discount) and add fundamentals.
 * Activates when FINNHUB_API_KEY is set; until then returns a clear "not connected".
 */
const KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export function equitiesReady(): boolean { return !!KEY; }

async function fh(path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${path}${sep}token=${KEY}`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Finnhub ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

export async function equityData(kind: string, symbol: string) {
  if(!/^[A-Za-z0-9.-]{1,20}$/.test(symbol??""))throw Error("Valid ticker required");
  if(!KEY){
   if(kind==="quote"){const q=await rhPrice(symbol);return {...q,source:"robinhood_underlying_feed",fallback:true,price:q.found?q.mid:null,note:"Underlying quote supplied by Robinhood; not the token DEX price. Market session and timestamp must be checked."};}
   return {connected:false,available:false,provider:"finnhub",note:"Configure FINNHUB_API_KEY for company profiles and fundamentals."};
  }
  const s = (symbol || "").trim().toUpperCase();
  if (!s) return { error: "symbol required (e.g. AAPL, NVDA, HOOD)" };
  if (kind === "quote") {
    const q = await fh(`/quote?symbol=${s}`);
    return { symbol: s, price: q.c ?? null, change: q.d ?? null, changePct: q.dp ?? null, high: q.h ?? null, low: q.l ?? null, open: q.o ?? null, prevClose: q.pc ?? null };
  }
  if (kind === "profile") {
    const p = await fh(`/stock/profile2?symbol=${s}`);
    return { symbol: s, name: p.name, exchange: p.exchange, industry: p.finnhubIndustry, marketCapUsdM: p.marketCapitalization, shareOutstandingM: p.shareOutstanding, ipo: p.ipo, weburl: p.weburl };
  }
  if (kind === "metrics") {
    const m = await fh(`/stock/metric?symbol=${s}&metric=all`);
    const x = m.metric || {};
    return { symbol: s, peTTM: x.peTTM ?? null, psTTM: x.psTTM ?? null, high52w: x["52WeekHigh"] ?? null, low52w: x["52WeekLow"] ?? null, epsTTM: x.epsTTM ?? null, dividendYield: x.dividendYieldIndicatedAnnual ?? null, beta: x.beta ?? null };
  }
  return { error: `unknown kind "${kind}". Valid: quote, profile, metrics.` };
}
