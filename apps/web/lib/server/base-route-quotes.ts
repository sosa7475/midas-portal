import { createPublicClient, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";

const V3_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const SLIP_QUOTER = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";
const SLIP_FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";
const poolAbi = parseAbi([
  "function factory() view returns (address)", "function token0() view returns (address)",
  "function token1() view returns (address)", "function tickSpacing() view returns (int24)",
  "function getPool(address,address,int24) view returns (address)",
]);
const v3Abi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)"]);
const slipAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)"]);
export interface BaseRouteInput { tokenIn: Address; tokenOut: Address; amountInRaw: bigint; slipstreamPools?: Address[] }
interface Quote { venue: "uniswap-v3" | "aerodrome-slipstream"; pool?: Address; feeTier?: number; tickSpacing?: number; amountOutRaw: string; quoteGas: string }

/** Quotes only. No signer, transaction builder, token approval, or broadcast path. */
export async function compareBaseRoutes(input: BaseRouteInput,
  client: Pick<PublicClient, "getChainId" | "getBlock" | "readContract" | "simulateContract"> = createPublicClient({ transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") })) {
  const { tokenIn, tokenOut, amountInRaw } = input;
  if (![tokenIn, tokenOut].every(x => isAddress(x)) || tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw new Error("Distinct token contract addresses required");
  if (typeof amountInRaw !== "bigint" || amountInRaw <= 0n || amountInRaw >= 2n ** 256n) throw new Error("Invalid raw input amount");
  const pools = input.slipstreamPools ?? [];
  if (pools.length > 4 || pools.some(p => !isAddress(p))) throw new Error("At most four valid Slipstream pool addresses required");
  if (await client.getChainId() !== 8453) throw new Error("Expected Base chain 8453");
  const block = await client.getBlock();
  if (block.number === null || !block.hash || Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 60) throw new Error("Fresh mined Base block required");
  const blockNumber = block.number;
  const quotes: Quote[] = [], unavailable: { venue: string; feeTier?: number; pool?: string; reason: string }[] = [];
  function add(q: Quote) {
    if (BigInt(q.amountOutRaw) <= 0n || BigInt(q.quoteGas) < 0n) throw new Error("Invalid quote output");
    quotes.push(q);
  }
  // Sequential, bounded reads avoid a burst against shared public RPCs.
  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const { result } = await client.simulateContract({ address: V3_QUOTER, abi: v3Abi, functionName: "quoteExactInputSingle", args: [{tokenIn,tokenOut,amountIn:amountInRaw,fee,sqrtPriceLimitX96:0n}], blockNumber });
      add({venue:"uniswap-v3",feeTier:fee,amountOutRaw:result[0].toString(),quoteGas:result[3].toString()});
    } catch { unavailable.push({venue:"uniswap-v3",feeTier:fee,reason:"Quote unavailable or invalid"}); }
  }
  for (const pool of [...new Set(pools.map(p => p.toLowerCase() as Address))]) {
    try {
      const factory = await client.readContract({address:pool,abi:poolAbi,functionName:"factory",blockNumber});
      const quoterFactory = await client.readContract({address:SLIP_QUOTER,abi:poolAbi,functionName:"factory",blockNumber});
      if (factory.toLowerCase() !== SLIP_FACTORY.toLowerCase() || quoterFactory.toLowerCase() !== factory.toLowerCase()) throw new Error("Unrecognized Slipstream factory");
      const token0 = await client.readContract({address:pool,abi:poolAbi,functionName:"token0",blockNumber});
      const token1 = await client.readContract({address:pool,abi:poolAbi,functionName:"token1",blockNumber});
      if ([token0,token1].map(t=>t.toLowerCase()).sort().join() !== [tokenIn,tokenOut].map(t=>t.toLowerCase()).sort().join()) throw new Error("Pool token mismatch");
      const tickSpacing = await client.readContract({address:pool,abi:poolAbi,functionName:"tickSpacing",blockNumber});
      const canonical = await client.readContract({address:factory,abi:poolAbi,functionName:"getPool",args:[token0,token1,tickSpacing],blockNumber});
      if (canonical.toLowerCase() !== pool) throw new Error("Pool does not match factory lookup");
      const {result} = await client.simulateContract({address:SLIP_QUOTER,abi:slipAbi,functionName:"quoteExactInputSingle",args:[{tokenIn,tokenOut,amountIn:amountInRaw,tickSpacing,sqrtPriceLimitX96:0n}],blockNumber});
      add({venue:"aerodrome-slipstream",pool,tickSpacing,amountOutRaw:result[0].toString(),quoteGas:result[3].toString()});
    } catch { unavailable.push({venue:"aerodrome-slipstream",pool,reason:"Pool identity verification or quote failed"}); }
  }
  if (!quotes.length) throw new Error("No verified successful routes");
  const verified = await client.getBlock({blockNumber});
  if (verified.hash !== block.hash || Math.abs(Date.now()/1000-Number(block.timestamp)) > 60) throw new Error("Quote block changed or became stale");
  quotes.sort((a,b)=>BigInt(a.amountOutRaw)>BigInt(b.amountOutRaw)?-1:BigInt(a.amountOutRaw)<BigInt(b.amountOutRaw)?1:BigInt(a.quoteGas)<BigInt(b.quoteGas)?-1:BigInt(a.quoteGas)>BigInt(b.quoteGas)?1:0);
  return { network:"base", blockNumber:blockNumber.toString(), blockHash:block.hash, observedAt:new Date().toISOString(),
    tokenIn,tokenOut,amountInRaw:amountInRaw.toString(),best:quotes[0],quotes,unavailable,
    selection:"Highest gross output among successful supported routes; gas estimate breaks ties. Not net-of-gas or all-market routing.",
    limitations:"ERC20 quote only. Native wrapping, approvals, transfer taxes, full transaction fees, signing permissions and executable fills are not established. Only the initial documented Slipstream factory is supported." };
}
