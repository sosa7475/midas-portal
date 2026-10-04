/**
 * Ostium — on-chain RWA/equity perpetuals (Arbitrum, Nasdaq-priced). Read-only price
 * feed: stocks (HOOD, NVDA, TSLA, AAPL, COIN, MSTR...), commodities, FX, indices, crypto.
 * Free, no key. Live bid/mid/ask + market-open status. (Execution is a future add.)
 */
const BASE = "https://metadata-backend.ostium.io";

const FIAT = new Set(["EUR", "USD", "GBP", "JPY", "CAD", "MXN", "HKD", "AUD", "NZD", "CHF", "CNH", "SGD", "SEK", "NOK", "TRY", "ZAR", "INR"]);
const COMMODITIES = new Set(["XAU", "XAG", "XPT", "XPD", "CL", "WTI", "BRENT", "DIESEL", "NG", "HG", "COCOA", "COFFEE", "COTTON", "SUGAR", "WHEAT", "CORN", "REMX"]);
const INDICES = new Set(["DJI", "NDX", "SPX", "KR2550", "DRAM", "VIX", "DAX", "FTSE", "NKY", "HYG"]);
const CRYPTO = new Set(["BTC", "ETH", "SOL", "BNB", "ADA", "LINK", "HYPE", "XRP", "DOGE", "AVAX", "DOT"]);

function category(from: string, to: string): string {
  if (FIAT.has(from) && FIAT.has(to)) return "fx";
  if (COMMODITIES.has(from)) return "commodity";
  if (INDICES.has(from)) return "index";
  if (CRYPTO.has(from)) return "crypto";
  return "stock";
}

async function prices(): Promise<any[]> {
  const r = await fetch(`${BASE}/PricePublish/latest-prices`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Ostium ${r.status}`);
  return r.json();
}

export async function ostiumQuote(symbol: string) {
  const s = symbol.trim().toUpperCase().replace(/[-_/].*$/, "");
  const d = await prices();
  const f = d.find((x) => String(x.from).toUpperCase() === s) ?? d.find((x) => `${x.from}/${x.to}`.toUpperCase() === symbol.trim().toUpperCase());
  if (!f) return { found: false, symbol: s, hint: "Not listed on Ostium. Call rwa_perp kind=markets to see available symbols." };
  return {
    found: true, pair: `${f.from}/${f.to}`, category: category(f.from, f.to),
    bid: f.bid, mid: f.mid, ask: f.ask,
    isMarketOpen: f.isMarketOpen, isDayTradingClosed: f.isDayTradingClosed,
    note: "Ostium perp price (leveraged, USDC-settled, self-custody). Not the spot share.",
  };
}

export async function ostiumMarkets(cat?: string) {
  const d = await prices();
  const groups: Record<string, { pair: string; open: boolean }[]> = { stock: [], commodity: [], index: [], fx: [], crypto: [] };
  for (const x of d) groups[category(x.from, x.to)]?.push({ pair: `${x.from}/${x.to}`, open: !!x.isMarketOpen });
  if (cat && groups[cat]) return { category: cat, count: groups[cat].length, markets: groups[cat] };
  return { total: d.length, counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), groups };
}
