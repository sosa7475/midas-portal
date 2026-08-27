/** DeFiLlama — keyless. Protocol TVL, top yields, chain TVL, historical macro filter. */

/**
 * Per-bar "risk-on" signal for backtesting: true when total DeFi TVL is higher
 * than ~30 days earlier (capital flowing in). Aligned to the given candles.
 */
/** As-of lookup helper: last value at or before ms (binary search over sorted [t,v]). */
function asOf(pts: { t: number; v: number }[], ms: number): number | null {
  let lo = 0, hi = pts.length - 1, res = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= ms) { res = mid; lo = mid + 1; } else hi = mid - 1; }
  return res >= 0 ? pts[res].v : null;
}

/**
 * Macro DeFi factors as candle-aligned series for backtesting: total DeFi TVL,
 * its 30-day % change, total stablecoin market cap, and its 30-day % change.
 * Missing data → null series (conditions on it simply won't trigger).
 */
export async function macroFactors(candles: { time: number }[]): Promise<Record<string, (number | null)[]>> {
  const DAY = 864e5;
  const empty = () => candles.map(() => null);
  const out: Record<string, (number | null)[]> = { defi_tvl: empty(), defi_tvl_roc30: empty(), stablecoin_mcap: empty(), stablecoin_roc30: empty() };

  try {
    const raw = (await j("https://api.llama.fi/v2/historicalChainTvl")) as { date: number; tvl: number }[];
    const pts = raw.map((p) => ({ t: p.date * 1000, v: p.tvl })).sort((a, b) => a.t - b.t);
    out.defi_tvl = candles.map((c) => asOf(pts, c.time));
    out.defi_tvl_roc30 = candles.map((c) => { const n = asOf(pts, c.time), p = asOf(pts, c.time - 30 * DAY); return n != null && p ? (n / p - 1) * 100 : null; });
  } catch {}

  try {
    const sc = (await j("https://stablecoins.llama.fi/stablecoincharts/all")) as any[];
    const pts = sc.map((p) => ({ t: Number(p.date) * 1000, v: Number(p.totalCirculatingUSD?.peggedUSD ?? p.totalCirculatingUSD ?? 0) })).filter((p) => p.v > 0).sort((a, b) => a.t - b.t);
    out.stablecoin_mcap = candles.map((c) => asOf(pts, c.time));
    out.stablecoin_roc30 = candles.map((c) => { const n = asOf(pts, c.time), p = asOf(pts, c.time - 30 * DAY); return n != null && p ? (n / p - 1) * 100 : null; });
  } catch {}

  return out;
}

export async function defiRiskOnSeries(candles: { time: number }[]): Promise<(boolean | null)[]> {
  let pts: { t: number; tvl: number }[];
  try {
    const r = await fetch("https://api.llama.fi/v2/historicalChainTvl", { signal: AbortSignal.timeout(12_000) });
    const raw = (await r.json()) as { date: number; tvl: number }[];
    pts = raw.map((p) => ({ t: p.date * 1000, tvl: p.tvl })).sort((a, b) => a.t - b.t);
  } catch {
    return candles.map(() => null);
  }
  const DAY = 864e5;
  const tvlAt = (ms: number): number | null => {
    // last point with t <= ms (binary search)
    let lo = 0, hi = pts.length - 1, res = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= ms) { res = mid; lo = mid + 1; } else hi = mid - 1; }
    return res >= 0 ? pts[res].tvl : null;
  };
  return candles.map((c) => {
    const now = tvlAt(c.time);
    const prev = tvlAt(c.time - 30 * DAY);
    if (now == null || prev == null) return null;
    return now > prev;
  });
}


async function j(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`DefiLlama ${r.status}`);
  return r.json();
}

export async function defiData(kind: string, queryStr?: string) {
  if (kind === "protocol" && queryStr) {
    const slug = queryStr.toLowerCase().replace(/\s+/g, "-");
    const d: any = await j(`https://api.llama.fi/protocol/${slug}`);
    return { name: d.name, category: d.category, chains: d.chains, tvl: d.currentChainTvls, symbol: d.symbol };
  }
  if (kind === "yields") {
    const d: any = await j("https://yields.llama.fi/pools");
    let pools = (d.data ?? []) as any[];
    if (queryStr) {
      const q = queryStr.toLowerCase();
      pools = pools.filter((p) => `${p.symbol} ${p.project} ${p.chain}`.toLowerCase().includes(q));
    }
    return pools
      // Realistic pools: meaningful TVL, sane APY (exclude degen/mispriced outliers).
      .filter((p) => p.tvlUsd > 5_000_000 && p.apy > 0 && p.apy < 300)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 12)
      .map((p) => ({ symbol: p.symbol, project: p.project, chain: p.chain, apy: Math.round(p.apy * 100) / 100, tvlUsd: Math.round(p.tvlUsd) }));
  }
  // chains
  const d: any = await j("https://api.llama.fi/v2/chains");
  return (d as any[]).sort((a, b) => b.tvl - a.tvl).slice(0, 15).map((c) => ({ name: c.name, tvl: c.tvl }));
}
