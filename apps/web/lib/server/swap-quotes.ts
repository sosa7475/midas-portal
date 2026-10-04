export const V3_FEE_TIERS = [500, 3000, 100, 10000] as const;
export interface V3Quote { fee: number; amountOut: bigint; gasEstimate: bigint }

/** Compare successful quotes, never treating unavailable liquidity as zero-cost execution. */
export async function compareV3Quotes(quote: (fee: number) => Promise<{amountOut: bigint; gasEstimate: bigint}>) {
  const results = await Promise.allSettled(V3_FEE_TIERS.map(async (fee) => {
    const q = await quote(fee);
    if (q.amountOut <= 0n || q.gasEstimate < 0n) throw new Error("Invalid quote");
    return {fee,...q};
  }));
  const quotes: V3Quote[] = [];
  const unavailableFeeTiers: number[] = [];
  results.forEach((r,i) => r.status === "fulfilled" ? quotes.push(r.value) : unavailableFeeTiers.push(V3_FEE_TIERS[i]));
  if (!quotes.length) throw new Error("No successful Uniswap v3 quote; liquidity may be absent or the RPC unavailable.");
  const legacy = quotes[0]; // old first-success routing, retained for comparison
  quotes.sort((a,b) => a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : a.gasEstimate < b.gasEstimate ? -1 : a.gasEstimate > b.gasEstimate ? 1 : a.fee-b.fee);
  return {best:quotes[0],quotes,unavailableFeeTiers,improvementRaw:quotes[0].amountOut-legacy.amountOut,legacyFee:legacy.fee};
}
