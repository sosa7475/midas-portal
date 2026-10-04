import {z} from "zod";
const decimal=z.string().regex(/^\d+(\.\d{1,18})?$/).refine(x=>Number.isFinite(Number(x))&&Number(x)>0);
const positive=z.number().finite().positive();
const key=z.string().min(1).max(120).optional();
const slippage=z.number().finite().min(0).max(3).optional();
const execution=z.object({intent:z.string().uuid()}).strict();
const schemas:Record<string,z.ZodTypeAny>={
 propose_position_action:z.object({action:z.enum(["close","cancel","protection"]),symbol:z.string().min(1).max(20),orderId:z.number().int().positive().optional(),stopLoss:positive.optional(),takeProfit:positive.optional(),requestKey:key}).passthrough().refine(v=>v.action!=="protection"||v.stopLoss!==undefined,"Protection requires a stop"),
 execute_swap:execution,execute_trade:execution,execute_order:execution,
 propose_swap:z.object({chain:z.enum(["base","robinhood"]).optional(),tokenIn:z.string().min(1).max(50),tokenOut:z.string().min(1).max(50),amountIn:decimal,slippagePct:slippage,requestKey:key,minimumOutRaw:z.string().regex(/^\d+$/).optional(),validUntilMs:positive.optional()}).passthrough(),
 propose_trade:z.object({symbol:z.string().min(1).max(20),side:z.enum(["long","short"]),quantity:positive,price:positive.optional(),stopLoss:positive.optional(),takeProfit:positive.optional(),slippagePct:slippage,requestKey:key}).passthrough(),
};
export function validateExecutionInput(name:string,args:unknown){if(schemas[name])schemas[name].parse(args);}
