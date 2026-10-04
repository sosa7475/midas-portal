import {appendFileSync,closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync} from "node:fs";
import {dirname} from "node:path";
import {createPaperState,digest,stepPaper,type PaperConfig,type PaperObservation,type PaperDecision} from "./paper-trading";

// Local research journal. Do not use ephemeral serverless storage as a durable ledger.
interface Event {sequence:number;previousHash:string;receivedAt?:number;observation:PaperObservation;decision:PaperDecision;hash:string}
export function recordPaperObservation(path:string,config:PaperConfig,observation:PaperObservation) {
  mkdirSync(dirname(path),{recursive:true});
  const lock=path+".lock";
  const fd=openSync(lock,"wx",0o600);
  try {
    let state=createPaperState(config),previousHash="",sequence=0;
    if(existsSync(path))for(const line of readFileSync(path,"utf8").split("\n").filter(Boolean)){
      const event=JSON.parse(line) as Event;
      const {hash,...body}=event;
      if(event.sequence!==sequence+1 || event.previousHash!==previousHash || hash!==digest(body))throw new Error("Paper journal integrity check failed");
      const replay=stepPaper(config,state,event.observation);
      if(digest(replay)!==digest(event.decision))throw new Error("Paper journal replay differs from recorded decision");
      state=event.decision.state;previousHash=hash;sequence=event.sequence;
    }
    const receivedAt=Date.now();
    if(!state.processed[observation.id] && (observation.observedAt>receivedAt || receivedAt-observation.observedAt>config.maxQuoteAgeMs))throw new Error("Forward journal only accepts freshly received observations; backfill and future data are rejected");
    const decision=stepPaper(config,state,observation);
    if(state.processed[observation.id])return {sequence,duplicate:true,decision};
    const body={sequence:sequence+1,previousHash,receivedAt,observation,decision};
    const event={...body,hash:digest(body)};
    appendFileSync(path,JSON.stringify(event)+"\n",{mode:0o600,flush:true});
    return {sequence:event.sequence,duplicate:false,decision};
  }finally{closeSync(fd);unlinkSync(lock);}
}
