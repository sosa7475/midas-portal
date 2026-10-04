export function hlOrderState(response:any){
 const order=response?.order,status=order?.status;
 if(response?.status!=="order"||typeof status!=="string")return {status:"unknown",filledSize:null};
 const total=Number(order.order?.origSz),remaining=Number(order.order?.sz);
 const filled=Number.isFinite(total)&&Number.isFinite(remaining)&&total>=remaining?total-remaining:null;
 if(status==="filled")return {status:"filled",filledSize:Number.isFinite(total)?total:filled};
 if(status==="open")return {status:filled!==null&&filled>0?"partially_filled":"submitted",filledSize:filled};
 if(/cancel|reject/i.test(status))return {status:filled!==null&&filled>0?"partially_filled":"cancelled",filledSize:filled};
 return {status:"unknown",filledSize:filled};
}
export function protectiveIds(id:string,p:any,kind:string){
 const base=BigInt(`0x${id.replace(/-/g,"")}`);
 const indexes=kind==="trade"?[...(p.stopLoss?[1]:[]),...(p.takeProfit?[2]:[])]:kind==="protection"?[0,...(p.takeProfit?[1]:[])]:[];
 return indexes.map(i=>`0x${(base^BigInt(i)).toString(16).padStart(32,"0")}`);
}
