import { decodeEventLog, encodeFunctionData, parseAbi, isAddress } from "viem";
const transfers = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const feeOracleAbi = parseAbi(["function getOperatorFee(uint256 gasUsed) view returns (uint256)"]);
const feeOracle = "0x420000000000000000000000000000000000000F";
type Rpc = (method: string, params: unknown[]) => Promise<any>;
const hash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
const quantity = (v: unknown): bigint | null => typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? BigInt(v) : null;

/** Read-only verification of scoped, recorded Base swaps. No signer or broadcast path. */
export async function verifyRecordedSwaps(records: any[], wallet: string, rpc: Rpc = async (method, params) => {
  const r = await fetch(process.env.BASE_RPC_URL || "https://mainnet.base.org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("RPC unavailable");
  const body = await r.json();
  if (body.error || !("result" in body)) throw new Error("RPC unavailable");
  return body.result;
}) {
  if (!isAddress(wallet)) throw new Error("Invalid agent wallet");
  const candidates = records.filter(r => r.kind === "trade" && (r.metrics?.chain || "base").toLowerCase() === "base" && hash(r.metrics?.swapTx)).slice(0, 3);
  const scope = "Up to three recent recorded Base swaps; not a full wallet history. Missing ledger records cannot be discovered by this check.";
  if (!candidates.length) return { status: "no_recorded_swaps", scope, swaps: [], realizedPnl: null };
  let head: bigint;
  try {
    if (quantity(await rpc("eth_chainId", [])) !== 8453n) throw new Error("Wrong chain");
    const n = quantity(await rpc("eth_blockNumber", [])); if (n === null) throw new Error("Missing head"); head = n;
  } catch { return { status: "unavailable", scope, swaps: [], realizedPnl: null, note: "Receipt provider unavailable or wrong chain; this does not mean no trades occurred." }; }
  async function receiptFor(txHash: string) {
    const r = await rpc("eth_getTransactionReceipt", [txHash]);
    if (!r) return { transactionHash: txHash, status: "pending_or_not_found" };
    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    const number = quantity(r.blockNumber), gas = quantity(r.gasUsed), price = quantity(r.effectiveGasPrice);
    if (!tx || r.transactionHash?.toLowerCase() !== txHash.toLowerCase() || tx.hash?.toLowerCase() !== txHash.toLowerCase() ||
        tx.from?.toLowerCase() !== wallet.toLowerCase() || r.from?.toLowerCase() !== wallet.toLowerCase() ||
        number === null || number > head || !hash(r.blockHash) || !["0x0", "0x1"].includes(r.status)) throw new Error("Unverified transaction identity");
    const block = await rpc("eth_getBlockByNumber", [r.blockNumber, false]);
    if (block?.hash?.toLowerCase() !== r.blockHash.toLowerCase()) throw new Error("Receipt block changed");
    const l2 = gas !== null && price !== null ? gas * price : null;
    const l1 = quantity(r.l1Fee);
    // The historical oracle handles fork-specific formulas and a genuine zero fee.
    // Never fall back to latest state or infer zero from missing receipt fields.
    let operator: bigint | null = null;
    const ordinaryTransaction = [0n, 1n, 2n, 4n].includes(quantity(tx.type) ?? -1n);
    if (gas !== null && ordinaryTransaction) {
      try {
        const value = await rpc("eth_call", [{ to: feeOracle,
          data: encodeFunctionData({ abi: feeOracleAbi, functionName: "getOperatorFee", args: [gas] }),
        }, { blockHash: r.blockHash, requireCanonical: true }]);
        if (typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)) operator = BigInt(value);
      } catch { /* Missing archive support means unknown fees, not zero. */ }
    }
    const rechecked = await rpc("eth_getBlockByNumber", [r.blockNumber, false]);
    if (rechecked?.hash?.toLowerCase() !== r.blockHash.toLowerCase()) throw new Error("Receipt block changed during fee verification");
    const total = l2 !== null && l1 !== null && operator !== null ? l2 + l1 + operator : null;
    const net = new Map<string, bigint>();
    if (r.status === "0x1") for (const log of r.logs ?? []) {
      try {
        const event = decodeEventLog({ abi: transfers, data: log.data, topics: log.topics });
        if (!isAddress(log.address)) continue;
        const { from, to, value } = event.args;
        const delta = (to.toLowerCase() === wallet.toLowerCase() ? value : 0n) - (from.toLowerCase() === wallet.toLowerCase() ? value : 0n);
        if (delta) net.set(log.address.toLowerCase(), (net.get(log.address.toLowerCase()) ?? 0n) + delta);
      } catch { /* Non-Transfer logs are not token balance evidence. */ }
    }
    return { transactionHash: txHash, status: r.status === "0x1" ? "confirmed_success" : "confirmed_reverted", blockNumber: number.toString(), blockHash: r.blockHash,
      confirmations: (head - number + 1n).toString(), finality: "Canonical at observation; not a finalized-block guarantee",
      transactionValueWei: quantity(tx.value)?.toString() ?? null,
      tokenNetTransfers: [...net].map(([token, delta]) => ({ token, netRaw: delta.toString() })),
      fees: { l2ExecutionWei: l2?.toString() ?? null, l1DataWei: l1?.toString() ?? null,
        knownFeeSubtotalWei: l2 !== null && l1 !== null ? (l2 + l1).toString() : null,
        operatorWei: operator?.toString() ?? null,
        operatorSource: operator !== null ? "GasPriceOracle.getOperatorFee at canonical receipt block" : null,
        totalNetworkFeeWei: total?.toString() ?? null,
        complete: total !== null,
        scope: "This transaction only; excludes separate approvals, swap venue fees and other transaction legs",
        note: total !== null ? "L2 execution, L1 data and historical operator fee verified. This is not realized PnL or full position cost."
          : "Complete network fee unavailable. Missing operator or receipt components remain unknown; native balance changes are not reconciled." },
    };
  }
  const swaps = await Promise.all(candidates.map(async row => {
    const m = row.metrics;
    try {
      const swap = await receiptFor(m.swapTx);
      const approval = hash(m.approveTx) ? await receiptFor(m.approveTx) : null;
      return { recordedAt: row.created_at, quotedAmountOut: m.amountOut ?? null, quotedTokenOut: m.tokenOut ?? m.tokenOutAddr ?? null, swap, approval };
    } catch { return { transactionHash: m.swapTx, status: "unavailable_or_unverified", note: "Receipt could not be verified; quoted output is not a confirmed fill." }; }
  }));
  return { status: "checked", scope, observedAt: new Date().toISOString(), swaps, realizedPnl: null,
    note: "Transfer-event evidence, not full economic PnL. WETH transfers remain WETH; do not label them native ETH. Cost basis, complete fees and all transaction legs must be reconciled before reporting realized profit." };
}
