/**
 * Token / smart-contract risk analysis via GoPlus Security (free, no key). Honeypot,
 * buy/sell tax, mint authority, ownership, pausable/blacklist, LP lock, holder concentration.
 * Returns the live fields + derived risk flags — nothing hardcoded; the verdict is computed
 * from real on-chain contract data each call.
 */
const CHAINS: Record<string, string> = {
  eth: "1", ethereum: "1", base: "8453", arbitrum: "42161", arb: "42161",
  optimism: "10", op: "10", bsc: "56", bnb: "56", polygon: "137", matic: "137",
  avalanche: "43114", avax: "43114",
};

const yes = (v: unknown) => v === "1" || v === 1;
const pct = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10000) / 100 : null; };

export async function tokenSecurity(chain: string, address: string) {
  const id = CHAINS[(chain || "eth").toLowerCase()];
  if (!id) return { supported: false, note: `Contract-risk analysis isn't available for "${chain}" (GoPlus covers eth, base, arbitrum, optimism, bsc, polygon, avalanche). For Solana or Robinhood Chain, rely on holder/liquidity signals from dex_analytics.` };
  if (!/^0x[0-9a-fA-F]{40}$/.test((address || "").trim())) return { error: "Pass the 0x token contract address." };

  const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${address}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`GoPlus ${r.status}`);
  const j = await r.json();
  const t = (j.result && (j.result[address.toLowerCase()] || Object.values(j.result)[0])) as any;
  if (!t) return { found: false, note: "No security data for this contract (unlisted or too new)." };

  const buyTax = pct(t.buy_tax), sellTax = pct(t.sell_tax);
  const ownerRenounced = !t.owner_address || /^0x0+$/.test(t.owner_address) || t.owner_address === "0x000000000000000000000000000000000000dead";

  const flags: string[] = [];
  if (yes(t.is_honeypot)) flags.push("HONEYPOT — cannot sell");
  if (yes(t.cannot_sell_all)) flags.push("cannot sell entire balance");
  if (yes(t.hidden_owner)) flags.push("hidden owner");
  if (yes(t.can_take_back_ownership)) flags.push("ownership can be reclaimed");
  if (yes(t.is_mintable)) flags.push("supply is mintable");
  if (yes(t.transfer_pausable)) flags.push("transfers can be paused");
  if (yes(t.is_blacklisted)) flags.push("wallets can be blacklisted/frozen");
  if (yes(t.slippage_modifiable)) flags.push("tax/slippage can be changed");
  if (!yes(t.is_open_source)) flags.push("contract not open-source/verified");
  if (!ownerRenounced) flags.push("ownership not renounced");
  if ((buyTax ?? 0) >= 10) flags.push(`high buy tax ${buyTax}%`);
  if ((sellTax ?? 0) >= 10) flags.push(`high sell tax ${sellTax}%`);

  const critical = yes(t.is_honeypot) || yes(t.cannot_sell_all) || yes(t.hidden_owner) || yes(t.can_take_back_ownership) || (sellTax ?? 0) >= 30;
  const riskLevel = critical ? "high" : flags.length >= 3 ? "medium" : flags.length ? "low-medium" : "low";

  const topHolders = (t.holders || []).slice(0, 3).map((h: any) => ({ pct: pct(h.percent), locked: yes(h.is_locked), tag: h.tag || null }));
  const lpLocked = (t.lp_holders || []).some((h: any) => yes(h.is_locked)) || null;

  return {
    chain, address, name: t.token_name, symbol: t.token_symbol,
    riskLevel, riskFlags: flags,
    isOpenSource: yes(t.is_open_source), isHoneypot: yes(t.is_honeypot),
    buyTaxPct: buyTax, sellTaxPct: sellTax, isMintable: yes(t.is_mintable),
    ownerRenounced, ownerAddress: t.owner_address || null,
    transferPausable: yes(t.transfer_pausable), canBlacklist: yes(t.is_blacklisted),
    holderCount: Number(t.holder_count) || null, lpHolderCount: Number(t.lp_holder_count) || null,
    lpLocked, topHolders,
    note: "Computed live from the deployed contract via GoPlus. Not financial advice — flags are risk signals, not proof of a scam.",
  };
}
