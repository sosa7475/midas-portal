import {NextResponse} from "next/server";
export async function POST(){return NextResponse.json({error:"Orderly execution is retired. Connect an approved Hyperliquid API wallet in Trading control to trade perpetuals."},{status:410});}
