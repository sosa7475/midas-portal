import {decodeEventLog,parseAbi} from "viem";
const transfers=parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
/** Net receipt transfers only. Quotes and successful broadcasts are not fill evidence. */
export function receivedToken(logs:readonly any[],token:string,wallet:string):bigint {
 let received=0n;
 for(const log of logs)if(log.address.toLowerCase()===token.toLowerCase())try{
  const e=decodeEventLog({abi:transfers,data:log.data,topics:log.topics});
  if(e.args.to.toLowerCase()===wallet.toLowerCase())received+=e.args.value;
  if(e.args.from.toLowerCase()===wallet.toLowerCase())received-=e.args.value;
 }catch{}
 return received;
}
