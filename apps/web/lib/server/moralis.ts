/**
 * Moralis Money — on-chain wallet/token analytics. Activates when MORALIS_API_KEY
 * is set (add it in Vercel env). Until then the tool returns a clear "not connected".
 */
const KEY = process.env.MORALIS_API_KEY;
const BASE = "https://deep-index.moralis.io/api/v2.2";

async function m(path: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "X-API-Key": KEY as string, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Moralis ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

export function moralisReady(): boolean {
  return !!KEY;
}

export async function onchain(kind: string, address: string, chain = "eth") {
  if (!KEY) return { connected: false, note: "Moralis is not connected. Add a MORALIS_API_KEY to enable on-chain data." };
  if (kind === "token_price") return m(`/erc20/${address}/price?chain=${chain}`);
  if (kind === "token_metadata") return m(`/erc20/metadata?chain=${chain}&addresses=${address}`);
  if (kind === "wallet_tokens") return m(`/wallet/${address}/tokens?chain=${chain}`);
  if (kind === "wallet_networth") return m(`/wallets/${address}/net-worth?chains=${chain}`);
  if (kind === "token_holders") return m(`/erc20/${address}/holders?chain=${chain}&limit=20`);
  return { error: "unknown kind" };
}
