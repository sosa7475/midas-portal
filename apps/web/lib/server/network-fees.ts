import {parseAbi,type Hex} from "viem";
const oracle="0x420000000000000000000000000000000000000F";
const abi=parseAbi(["function getL1Fee(bytes data) view returns (uint256)","function getOperatorFee(uint256 gasUsed) view returns (uint256)"]);
/** Arbitrum-style chains bundle data cost into gas. OP Stack needs additional fee components. */
export async function estimatedNetworkFee(client:any,chain:string,tx:{gas:bigint;maxFeePerGas:bigint},serialized:Hex){
 const execution=tx.gas*tx.maxFeePerGas;
 if(["robinhood","arbitrum","ethereum"].includes(chain))return execution;
 if(!["base","optimism"].includes(chain))throw Error("Unsupported fee model");
 const [l1,operator]=await Promise.all([client.readContract({address:oracle,abi,functionName:"getL1Fee",args:[serialized]}),client.readContract({address:oracle,abi,functionName:"getOperatorFee",args:[tx.gas]})]);
 // Conservative estimate, not a protocol-enforced cap on OP Stack data fees.
 return execution+2n*(BigInt(l1)+BigInt(operator));
}
export async function receiptNetworkFee(client:any,chain:string,receipt:any):Promise<bigint|null>{
 const execution=BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice);
 if(["robinhood","arbitrum","ethereum"].includes(chain))return execution;
 if(!["base","optimism"].includes(chain))return null;
 try{
  const raw=await client.request({method:"eth_getTransactionReceipt",params:[receipt.transactionHash]});
  if(raw.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()||typeof raw.l1Fee!=="string")return null;
  const operator=await client.readContract({address:oracle,abi,functionName:"getOperatorFee",args:[receipt.gasUsed],blockNumber:receipt.blockNumber});
  const canonical=await client.getBlock({blockNumber:receipt.blockNumber});if(canonical.hash!==receipt.blockHash)return null;
  return execution+BigInt(raw.l1Fee)+BigInt(operator);
 }catch{return null;}
}
