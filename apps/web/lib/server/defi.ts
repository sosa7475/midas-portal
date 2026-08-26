/** DeFiLlama — keyless. Protocol TVL, top yields, chain TVL. */
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
      .filter((p) => p.tvlUsd > 1_000_000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 12)
      .map((p) => ({ symbol: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvlUsd: p.tvlUsd }));
  }
  // chains
  const d: any = await j("https://api.llama.fi/v2/chains");
  return (d as any[]).sort((a, b) => b.tvl - a.tvl).slice(0, 15).map((c) => ({ name: c.name, tvl: c.tvl }));
}
