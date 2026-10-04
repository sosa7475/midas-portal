import {z} from "zod";
export const scopesSchema=z.array(z.enum(["read","research","propose","execute"])).min(1).max(4);
export const DEFAULT_SCOPES=["read","research","propose"];
export function requiredScope(name:string):string {
 if(["execute_trade","execute_swap","execute_order"].includes(name))return "execute";
 if(name.startsWith("propose_")||name==="publish_trade_idea")return "propose";
 if(name==="update_strategy"||name==="backtest_strategy")return "research";
 return "read";
}
export function permitted(name:string,scopes:string[]){return scopes.includes(requiredScope(name));}
