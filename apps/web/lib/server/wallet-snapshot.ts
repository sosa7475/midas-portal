import { formatUnits, isAddress, type Address } from "viem";

export function trackedBaseTokens(rows: any[], extra: unknown, usdc: string): Address[] {
  if (extra !== undefined && (!Array.isArray(extra) || extra.length > 20 || extra.some(x => typeof x !== "string" || !isAddress(x)))) {
    throw new Error("baseTokenAddresses must contain at most 20 valid token addresses");
  }
  const tokens = new Set<string>();
  for (const address of (extra ?? []) as string[]) tokens.add(address.toLowerCase());
  for (const row of rows) {
    const m = row?.metrics;
    if (row?.kind !== "trade" || String(m?.chain).toLowerCase() !== "base") continue;
    for (const address of [m.tokenInAddr, m.tokenOutAddr, m.tokenIn, m.tokenOut]) {
      if (typeof address === "string" && isAddress(address)) tokens.add(address.toLowerCase());
    }
  }
  tokens.delete(usdc.toLowerCase());
  return [...tokens].slice(0, 40) as Address[];
}

interface Reads {
  native: () => Promise<bigint>;
  usdc: () => Promise<bigint>;
  ethPrice: () => Promise<number | null>;
  token: (address: Address) => Promise<{ balance: bigint; decimals: number }>;
}

/** Known assets only: no signer, token discovery service, or implicit zero on failures. */
export async function walletSnapshot(addresses: Address[], reads: Reads) {
  const errors: string[] = [];
  async function read<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try { return await fn(); } catch { errors.push(`${label} unavailable`); return null; }
  }
  const [native, usdcRaw, px] = await Promise.all([
    read("ETH balance", reads.native), read("USDC balance", reads.usdc), read("ETH price", reads.ethPrice),
  ]);
  const eth = native === null ? null : Number(formatUnits(native, 18));
  const usdc = usdcRaw === null ? null : Number(formatUnits(usdcRaw, 6));
  const ethPx = typeof px === "number" && Number.isFinite(px) && px > 0 ? px : null;
  if (ethPx === null && !errors.includes("ETH price unavailable")) errors.push("ETH price unavailable");
  const tokens = [];
  // Bounded sequential reads reduce bursts against public RPCs.
  for (const address of addresses) {
    const token = await read(`Token ${address}`, () => reads.token(address));
    if (token && (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255 || token.balance < 0n)) {
      errors.push(`Token ${address} returned invalid balance metadata`);
      tokens.push({ address, balance: null, balanceRaw: null, decimals: null, valueUsd: null });
    } else {
      tokens.push({ address, balance: token ? formatUnits(token.balance, token.decimals) : null,
        balanceRaw: token ? token.balance.toString() : null, decimals: token?.decimals ?? null, valueUsd: null });
    }
  }
  const coreValueUsd = eth !== null && usdc !== null && (eth === 0 || ethPx !== null)
    ? Math.round((usdc + eth * (ethPx ?? 0)) * 100) / 100 : null;
  return {
    eth, usdc, ethRaw: native?.toString() ?? null, usdcRaw: usdcRaw?.toString() ?? null,
    ethExact: native === null ? null : formatUnits(native, 18), usdcExact: usdcRaw === null ? null : formatUnits(usdcRaw, 6),
    coreValueUsd, valueUsd: null, valuationScope: "coreValueUsd covers native ETH and USDC only; total wallet value is unknown. USDC is valued at $1; ETH uses a mark-price proxy.",
    tokens, inventoryComplete: false,
    inventoryScope: "Additional token addresses come from at most 100 recent performance records and explicit requests, capped at 40. Transfers and older assets may be missing. Reads may use different blocks.",
    errors, observedAt: new Date().toISOString(),
  };
}
