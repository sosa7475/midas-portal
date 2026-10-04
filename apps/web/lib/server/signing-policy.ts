/** Static ABI offsets for SwapRouter02.exactInputSingle's seven-word tuple. */
export function swapPolicyCondition(routes:{chainId:number;router:string}[],owner:string) {
 if(!/^0x[0-9a-f]{40}$/i.test(owner))throw Error("Invalid policy wallet");
 const recipient=owner.toLowerCase().slice(2).padStart(64,"0");
 const networks=routes.map(r=>`(eth.tx.chain_id == ${r.chainId} && eth.tx.to == '${r.router.toLowerCase()}')`).join(" || ");
 return `activity.kind == 'SIGN_TRANSACTION' && (${networks}) && eth.tx.data[0..10] == '0x04e45aaf' && eth.tx.data[202..266] == '${recipient}'`;
}
