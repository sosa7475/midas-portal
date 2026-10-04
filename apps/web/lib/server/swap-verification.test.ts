import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbi, parseAbiParameters } from "viem";
import { verifyRecordedSwaps } from "./swap-verification";
const wallet = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`, token = `0x${"33".repeat(20)}`;
const tx = `0x${"aa".repeat(32)}`, block = `0x${"bb".repeat(32)}`;
const records = [{ kind: "trade", metrics: { chain: "base", swapTx: tx, amountOut: "999" } }];
const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const log = (from: string, to: string, value: bigint) => ({ address: token, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }), data: encodeAbiParameters(parseAbiParameters("uint256"), [value]) });
function fixture(overrides: Record<string, any> = {}) {
  return async (method: string) => {
    if (method in overrides) { const v = overrides[method]; if (v instanceof Error) throw v; return v; }
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_blockNumber") return "0x65";
    if (method === "eth_getBlockByNumber") return { hash: block };
    if (method === "eth_getTransactionByHash") return { hash: tx, from: wallet, value: "0x0", type: "0x2" };
    if (method === "eth_getTransactionReceipt") return { transactionHash: tx, from: wallet, blockNumber: "0x64", blockHash: block, status: "0x1", gasUsed: "0x64", effectiveGasPrice: "0x2", l1Fee: "0x3", logs: [log(other, wallet, 10n), log(wallet, other, 2n)] };
    throw new Error("Unexpected RPC");
  };
}
test("receipt evidence replaces quotes with actual net transfers and partial fee labels", async () => {
  const r: any = await verifyRecordedSwaps(records, wallet, fixture());
  const s = r.swaps[0].swap;
  assert.equal(s.status, "confirmed_success"); assert.equal(s.confirmations, "2");
  assert.deepEqual(s.tokenNetTransfers, [{ token, netRaw: "8" }]);
  assert.equal(r.swaps[0].quotedAmountOut, "999"); assert.equal(s.fees.knownFeeSubtotalWei, "203");
  assert.equal(s.fees.complete, false); assert.equal(r.realizedPnl, null);
});
test("missing receipt means pending or not found, never a confirmed fill", async () => {
  const r: any = await verifyRecordedSwaps(records, wallet, fixture({ eth_getTransactionReceipt: null }));
  assert.equal(r.swaps[0].swap.status, "pending_or_not_found");
});
test("wrong sender and reorgs cannot verify another wallet's transaction", async () => {
  for (const patch of [{ eth_getTransactionByHash: { hash: tx, from: other, value: "0x0" } }, { eth_getBlockByNumber: { hash: tx } }]) {
    const r: any = await verifyRecordedSwaps(records, wallet, fixture(patch));
    assert.equal(r.swaps[0].status, "unavailable_or_unverified");
  }
});
test("reverted transactions have no successful token transfers", async () => {
  const receipt = await fixture()("eth_getTransactionReceipt"); receipt.status = "0x0";
  const r: any = await verifyRecordedSwaps(records, wallet, fixture({ eth_getTransactionReceipt: receipt }));
  assert.equal(r.swaps[0].swap.status, "confirmed_reverted"); assert.deepEqual(r.swaps[0].swap.tokenNetTransfers, []);
});
test("missing L1 fee is unknown, not zero", async () => {
  const receipt = await fixture()("eth_getTransactionReceipt"); delete receipt.l1Fee;
  const r: any = await verifyRecordedSwaps(records, wallet, fixture({ eth_getTransactionReceipt: receipt }));
  assert.equal(r.swaps[0].swap.fees.knownFeeSubtotalWei, null);
});
test("wrong chain or provider failure does not masquerade as no swaps", async () => {
  for (const v of ["0x1", new Error("offline")]) {
    const r = await verifyRecordedSwaps(records, wallet, fixture({ eth_chainId: v })); assert.equal(r.status, "unavailable");
  }
});
test("simulations are excluded and receipt work is bounded", async () => {
  const ignored = await verifyRecordedSwaps([{ kind: "backtest", metrics: records[0].metrics }], wallet, fixture());
  assert.equal(ignored.status, "no_recorded_swaps");
  const limited = await verifyRecordedSwaps(Array.from({ length: 10 }, () => records[0]), wallet, fixture()); assert.equal(limited.swaps.length, 3);
});

test("historical operator fees include zero and nonzero values with canonical block pinning", async () => {
  for (const operator of [0n, 57n]) {
    const base = fixture();
    let called = false;
    const r: any = await verifyRecordedSwaps(records, wallet, async (method, params) => {
      if (method !== "eth_call") return base(method);
      called = true;
      assert.deepEqual(params, [{ to: "0x420000000000000000000000000000000000000F", data: "0x275aedd2" + (100n).toString(16).padStart(64, "0") }, { blockHash: block, requireCanonical: true }]);
      return "0x" + operator.toString(16).padStart(64, "0");
    });
    assert.equal(called, true);
    const f = r.swaps[0].swap.fees;
    assert.equal(f.operatorWei, operator.toString()); assert.equal(f.totalNetworkFeeWei, (203n + operator).toString());
    assert.equal(f.complete, true); assert.equal(r.realizedPnl, null);
  }
});
test("failed or malformed historical oracle responses preserve receipts with unknown total fees", async () => {
  for (const value of [new Error("archive unavailable"), "0x", "0x0", null, "0x" + "00".repeat(33)]) {
    const r: any = await verifyRecordedSwaps(records, wallet, fixture({ eth_call: value }));
    const s = r.swaps[0].swap;
    assert.equal(s.status, "confirmed_success"); assert.equal(s.fees.operatorWei, null);
    assert.equal(s.fees.totalNetworkFeeWei, null); assert.equal(s.fees.complete, false);
  }
});
test("unknown transaction types and missing L1 components cannot claim complete fees", async () => {
  const oracle = "0x" + "00".repeat(32);
  const receipt = await fixture()("eth_getTransactionReceipt"); delete receipt.l1Fee;
  for (const patch of [{ eth_getTransactionByHash: { hash: tx, from: wallet, value: "0x0", type: "0x7e" } }, { eth_getTransactionReceipt: receipt }]) {
    const r: any = await verifyRecordedSwaps(records, wallet, fixture({ eth_call: oracle, ...patch }));
    assert.equal(r.swaps[0].swap.fees.complete, false); assert.equal(r.swaps[0].swap.fees.totalNetworkFeeWei, null);
  }
});
test("a block change during historical fee lookup invalidates verification", async () => {
  const base = fixture(); let reads = 0;
  const r: any = await verifyRecordedSwaps(records, wallet, async method => {
    if (method === "eth_getBlockByNumber" && ++reads > 1) return { hash: tx };
    return base(method);
  });
  assert.equal(r.swaps[0].status, "unavailable_or_unverified");
});
