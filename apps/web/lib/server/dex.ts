import {estimatedNetworkFee,receiptNetworkFee} from "./network-fees";
import {receivedToken} from "./receipt-output";
/**
 * Classic on-chain swaps via Unispwap v3 — quote + build + broadcast. Signing is done by
 * Turnkey (policy-gated to the router), so the agent can swap but not withdraw. Reads/quotes
 * and broadcasts use free public RPCs (Alchemy optional later for reliability).
 */
import { assertReviewCurrent, reviewedSwapMinimum } from "./swap-review";
import { compareV3Quotes } from "./swap-quotes";
import { createPublicClient, http, encodeFunctionData, parseUnits, formatUnits, serializeTransaction, maxUint256, keccak256, decodeEventLog, type Address } from "viem";

export interface ChainCfg { id: number; rpc: string; quoter: Address; router: Address; usdc?: Address; wnative: Address; name: string }

// Uniswap V3 SwapRouter02 + QuoterV2 per chain. Mainnet/Arbitrum/Optimism share addresses; Base and Robinhood Chain differ.
export const CHAINS: Record<string, ChainCfg> = {
  base: {
    id: 8453, name: "Base", rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wnative: "0x4200000000000000000000000000000000000006",
  },
  ethereum: {
    id: 1, name: "Ethereum", rpc: process.env.ETH_RPC_URL || "https://eth.drpc.org",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wnative: "0xC02aaa39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  arbitrum: {
    id: 42161, name: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    wnative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  optimism: {
    id: 10, name: "Optimism", rpc: "https://mainnet.optimism.io",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    wnative: "0x4200000000000000000000000000000000000006",
  },
  robinhood: {
    id: 4663, name: "Robinhood Chain", rpc: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
    router: "0xcaf681a66d020601342297493863e78c959e5cb2",
    wnative: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // usdc omitted — many impostor USDC tokens on RH chain; pass explicit contracts
  },
};

const QUOTER_ABI = [{ inputs: [{ components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" }, { name: "sqrtPriceLimitX96", type: "uint160" }], name: "params", type: "tuple" }], name: "quoteExactInputSingle", outputs: [{ name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" }, { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" }], stateMutability: "nonpayable", type: "function" }] as const;

const ROUTER_ABI = [{ inputs: [{ components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }], name: "params", type: "tuple" }], name: "exactInputSingle", outputs: [{ name: "amountOut", type: "uint256" }], stateMutability: "payable", type: "function" }] as const;

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;

export function chainCfg(chain: string): ChainCfg {
  const c = CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unsupported chain "${chain}". Available: ${Object.keys(CHAINS).join(", ")}.`);
  return c;
}
function pub(c: ChainCfg) { return createPublicClient({ transport: http(c.rpc) }); }

/** Compare supported single-hop v3 pools at one block; maximize gross token output. */
export async function quoteSwap(chain: string, tokenIn: Address, tokenOut: Address, amountInHuman: string, decimalsIn: number, decimalsOut: number) {
  const c = chainCfg(chain);
  for (const decimals of [decimalsIn, decimalsOut]) if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid token decimals");
  if (!/^\d+(\.\d+)?$/.test(amountInHuman)) throw new Error("Amount must be a positive decimal string");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw new Error("Swap tokens must differ");
  const fraction = amountInHuman.split(".")[1] ?? "";
  if (fraction.length > decimalsIn) throw new Error("Amount exceeds token precision");
  const amountIn = parseUnits(amountInHuman, decimalsIn);
  if (amountIn <= 0n) throw new Error("Swap amount must be positive");
  const client = pub(c);
  if (await client.getChainId() !== c.id) throw new Error("RPC chain identity mismatch");
  const blockNumber = await client.getBlockNumber();
  const comparison = await compareV3Quotes(async (fee) => {
    const {result} = await client.simulateContract({ address: c.quoter, abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96:0n}], blockNumber });
    return {amountOut:result[0],gasEstimate:result[3]};
  });
  return {
    amountOut:formatUnits(comparison.best.amountOut,decimalsOut), amountOutRaw:comparison.best.amountOut, amountIn, fee:comparison.best.fee,
    blockNumber:blockNumber.toString(), gasEstimate:comparison.best.gasEstimate.toString(),
    quotes:comparison.quotes.map(q=>({feeTier:q.fee,feeBps:q.fee/100,amountOut:formatUnits(q.amountOut,decimalsOut),gasEstimate:q.gasEstimate.toString()})),
    unavailableFeeTiers:comparison.unavailableFeeTiers,
    improvementVsFirstPool:formatUnits(comparison.improvementRaw,decimalsOut), legacyFeeTier:comparison.legacyFee,
    selectionRule:"Highest quoted token output among successful supported single-hop pools; tie-break by estimated gas. Not net-of-gas routing. Quotes are indicative, not fills.",
  };
}

/** Build the unsigned swap tx (exactInputSingle) with slippage-protected min out. */
export async function buildSwapTx(chain: string, from: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, amountOutMin: bigint, feeTier: number, nativeIn = false) {
  const c = chainCfg(chain);
  const client = pub(c);
  // Native-ETH input: tokenIn stays WETH in the call, but we send msg.value = amountIn and the
  // SwapRouter02 wraps it internally (no approval / no WETH balance needed).
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee: feeTier, recipient: from, amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n }] });
  const [nonce, fees] = await Promise.all([client.getTransactionCount({ address: from, blockTag:"pending" }), client.estimateFeesPerGas()]);
  const estimated=await client.estimateGas({account:from,to:c.router,data,value:nativeIn?amountIn:0n});
  return { to: c.router, data, value: nativeIn ? amountIn : 0n, chainId: c.id, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, gas: estimated*125n/100n } as const;
}

/** Build an ERC20 approve tx (spender = router). Needed once per token before swaps. */
export async function buildApproveTx(chain: string, from: Address, token: Address, amount: bigint) {
  const c = chainCfg(chain);
  const client = pub(c);
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [c.router, amount] });
  const [nonce, fees] = await Promise.all([client.getTransactionCount({ address: from, blockTag:"pending" }), client.estimateFeesPerGas()]);
  const estimated=await client.estimateGas({account:from,to:token,data,value:0n});
  return { to: token, data, value: 0n, chainId: c.id, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, gas: estimated*125n/100n } as const;
}

export async function currentAllowance(chain: string, owner: Address, token: Address): Promise<bigint> {
  const c = chainCfg(chain);
  return pub(c).readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, c.router] }) as Promise<bigint>;
}

export async function broadcast(chain: string, signedTxHex: string): Promise<string> {
  const c = chainCfg(chain);
  const hash = await pub(c).sendRawTransaction({ serializedTransaction: (signedTxHex.startsWith("0x") ? signedTxHex : `0x${signedTxHex}`) as `0x${string}` });
  return hash;
}

// Common Base tokens (symbol → address); raw 0x addresses pass through.
const TOKENS: Record<string, Record<string, Address>> = {
  base: {
    usdc: CHAINS.base.usdc!, weth: CHAINS.base.wnative, eth: CHAINS.base.wnative,
    aero: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    cbbtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    degen: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    brett: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    virtual: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
  },
  ethereum: { usdc: CHAINS.ethereum.usdc!, weth: CHAINS.ethereum.wnative, eth: CHAINS.ethereum.wnative },
  arbitrum: { usdc: CHAINS.arbitrum.usdc!, weth: CHAINS.arbitrum.wnative, eth: CHAINS.arbitrum.wnative },
  optimism: { usdc: CHAINS.optimism.usdc!, weth: CHAINS.optimism.wnative, eth: CHAINS.optimism.wnative },
  robinhood: { weth: CHAINS.robinhood.wnative, eth: CHAINS.robinhood.wnative },
};
export function resolveToken(chain: string, t: string): Address {
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase() as Address;
  const a = TOKENS[chain.toLowerCase()]?.[t.toLowerCase()];
  if (!a) throw new Error(`Unknown token "${t}" on ${chain}. Pass a 0x address or a known symbol.`);
  return a;
}
export async function getDecimals(chain: string, token: Address): Promise<number> {
  const c = chainCfg(chain);
  const decimals = Number(await pub(c).readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid token decimals");
  return decimals;
}

/** Native + ERC20 balance reads (for portfolio value + max-withdraw). */
export async function nativeBalance(chain: string, addr: Address): Promise<bigint> {
  return pub(chainCfg(chain)).getBalance({ address: addr });
}
export async function tokenBalance(chain: string, token: Address, addr: Address): Promise<bigint> {
  return pub(chainCfg(chain)).readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf" as any, args: [addr] }) as Promise<bigint>;
}

/** Build an unsigned withdrawal tx: native ETH send, or ERC20 transfer, to `to`. */
export async function buildWithdrawTx(chain: string, from: Address, to: Address, opts: { native?: boolean; token?: Address; amount: bigint }) {
  const c = chainCfg(chain);
  const client = pub(c);
  const [nonce, fees] = await Promise.all([client.getTransactionCount({ address: from, blockTag:"pending" }), client.estimateFeesPerGas()]);
  const base = { chainId: c.id, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas } as const;
  if (opts.native) return { ...base, to, value: opts.amount, data: "0x" as const, gas: 21000n };
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer" as any, args: [to, opts.amount] });
  return { ...base, to: opts.token!, value: 0n, data, gas: 80000n };
}

/**
 * Execute a swap: quote → (approve router if needed) → swap. Signing is delegated to `sign`
 * (Turnkey, policy-gated), so this module never touches a private key. Broadcasts via public RPC.
 */
export async function executeSwap(chain: string, from: Address, sign: (unsignedTxHex: string) => Promise<string>, p: { tokenIn: Address; tokenOut: Address; amountInHuman: string; decimalsIn: number; decimalsOut: number; slippagePct?: number; nativeIn?: boolean; minimumOutRaw?: string; validUntilMs?: number; gasReserveEth?: string; maxGasEth?: string; onTransaction?: (stage:string,hash:string)=>Promise<void> }) {
  const c = chainCfg(chain);
  const client = pub(c);
  const q = await quoteSwap(chain, p.tokenIn, p.tokenOut, p.amountInHuman, p.decimalsIn, p.decimalsOut);
  const slippage = p.slippagePct ?? 0.5;
  if(!Number.isFinite(slippage)||slippage<0||slippage>3)throw new Error("Slippage must be between 0 and 3 percent");
  const slip = BigInt(Math.round(slippage * 100));
  const minOut = reviewedSwapMinimum(q.amountOutRaw, q.amountOutRaw - (q.amountOutRaw * slip) / 10000n, p.minimumOutRaw);
  const checkExpiry = () => assertReviewCurrent(p.validUntilMs);
  checkExpiry();
  let nonce = await client.getTransactionCount({ address: from, blockTag:"pending" });
  const out: any = { quotedAmountOut: q.amountOut, amountOut: null, minOut: formatUnits(minOut, p.decimalsOut), feeTier: q.fee, paidWith: p.nativeIn ? "native ETH" : undefined };

  const reserve=parseUnits(p.gasReserveEth??"0.0001",18), maxGas=parseUnits(p.maxGasEth??"0.0001",18);
  if(reserve<0n || maxGas<=0n)throw new Error("Invalid gas budget");
  let spent=0n;let completeFees=true;
  async function budget(tx:any,signed:string){
   const estimated=await estimatedNetworkFee(client,chain,tx,(signed.startsWith("0x")?signed:`0x${signed}`) as `0x${string}`);
   if(spent+estimated>maxGas)throw Error("Total network fee estimate exceeds remaining order budget");
   if(await client.getBalance({address:from})<(tx.value??0n)+reserve+estimated)throw Error("Insufficient ETH to retain gas reserve");
  }
  if(await client.getBalance({address:from}) < (p.nativeIn?q.amountIn:0n)+reserve+maxGas)throw new Error("Insufficient native ETH for input, gas budget and reserve");
  if(!p.nativeIn && await tokenBalance(chain,p.tokenIn,from)<q.amountIn)throw new Error("Insufficient input token balance");
  if(!(await client.getCode({address:c.router})) || !(await client.getCode({address:c.quoter})))throw new Error("Router or quoter unavailable on this chain");
  // Native ETH is sent as msg.value (router wraps it) — no approval needed. ERC20 needs approve first.
  if (!p.nativeIn) {
    const allowance = await currentAllowance(chain, from, p.tokenIn);
    if (allowance < q.amountIn) {
      const ax = await buildApproveTx(chain, from, p.tokenIn, q.amountIn);
      checkExpiry();
      const signed = await sign(serializeTransaction({ ...ax, nonce }));
      await budget(ax,signed);
      const expectedHash=keccak256((signed.startsWith("0x")?signed:`0x${signed}`) as `0x${string}`);
      await p.onTransaction?.("approval",expectedHash);
      const h = await broadcast(chain, signed);
      const approval=await client.waitForTransactionReceipt({ hash: h as `0x${string}`, timeout: 45_000 });
      const approvalFee=await receiptNetworkFee(client,chain,approval);
      if(approvalFee===null)throw Error("Approval fee unavailable; reconcile before spending more");
      spent+=approvalFee;out.approvalFeeWei=approvalFee.toString();
      if(approval.status!=="success")throw new Error("Approval transaction reverted");
      out.approveTx = h; nonce++;
    }
  }
  const sx = await buildSwapTx(chain, from, p.tokenIn, p.tokenOut, q.amountIn, minOut, q.fee, !!p.nativeIn);
  checkExpiry();
  await client.call({account:from,to:sx.to,data:sx.data,value:sx.value});
  const signedSwap = await sign(serializeTransaction({ ...sx, nonce }));
  await budget(sx,signedSwap);
  const expectedHash=keccak256((signedSwap.startsWith("0x")?signedSwap:`0x${signedSwap}`) as `0x${string}`);
  await p.onTransaction?.("swap",expectedHash);
  out.swapTx = await broadcast(chain, signedSwap);
  const receipt=await client.waitForTransactionReceipt({hash:out.swapTx as `0x${string}`,confirmations:2,timeout:45_000});
  out.status=receipt.status==="success"?"filled":"reverted";
  out.blockNumber=receipt.blockNumber.toString();out.blockHash=receipt.blockHash;
  out.executionFeeWei=(receipt.gasUsed*receipt.effectiveGasPrice).toString();
  const swapFee=await receiptNetworkFee(client,chain,receipt);
  out.totalFeeWei=swapFee===null?null:(spent+swapFee).toString();out.feeCoverage=swapFee===null?"Incomplete network fee evidence":"All recorded approval and swap network fees";
  if(receipt.status!=="success")return out;
  const received=receivedToken(receipt.logs,p.tokenOut,from);
  out.amountOut= formatUnits(received,p.decimalsOut);out.amountOutRaw=received.toString();
  if(received<minOut) {out.status="review_required";out.error="Receipt output below reviewed minimum; investigate token transfer behavior";}
  return out;
}
