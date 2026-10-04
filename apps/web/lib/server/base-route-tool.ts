import {formatUnits, isAddress, parseUnits, type Address} from "viem";
import {getDecimals, resolveToken} from "./dex";
import {compareBaseRoutes} from "./base-route-quotes";

/** Public market-data wrapper: never reads a wallet, signs, or creates an order intent. */
export async function quoteBaseRouteTool(args: {tokenIn:string;tokenOut:string;amountIn:string;slipstreamPools?:Address[]}) {
  if (typeof args.amountIn !== "string" || !/^\d+(\.\d+)?$/.test(args.amountIn) || !/[1-9]/.test(args.amountIn)) throw new Error("amountIn must be a positive human-unit decimal string");
  if (typeof args.tokenIn !== "string" || typeof args.tokenOut !== "string") throw new Error("Token symbols or addresses required");
  const tokenIn=resolveToken("base",args.tokenIn),tokenOut=resolveToken("base",args.tokenOut);
  if(!isAddress(tokenIn)||!isAddress(tokenOut)||tokenIn.toLowerCase()===tokenOut.toLowerCase())throw new Error("Distinct valid token addresses required");
  if(args.slipstreamPools!==undefined&&(!Array.isArray(args.slipstreamPools)||args.slipstreamPools.length>4||args.slipstreamPools.some(p=>!isAddress(p))))throw new Error("At most four valid Slipstream pool addresses required");
  const decimalsIn=await getDecimals("base",tokenIn),decimalsOut=await getDecimals("base",tokenOut);
  if((args.amountIn.split(".")[1]??"").length>decimalsIn)throw new Error("Amount exceeds token precision");
  const result=await compareBaseRoutes({tokenIn,tokenOut,amountInRaw:parseUnits(args.amountIn,decimalsIn),slipstreamPools:args.slipstreamPools});
  const human=(q:typeof result.best)=>({...q,amountOut:formatUnits(BigInt(q.amountOutRaw),decimalsOut)});
  return {...result,amountIn:args.amountIn,decimalsIn,decimalsOut,best:human(result.best),quotes:result.quotes.map(human),nativeTokenNote:"ETH aliases resolve to WETH for quoting. This tool does not wrap or unwrap ETH, create an intent, or authorize execution."};
}
