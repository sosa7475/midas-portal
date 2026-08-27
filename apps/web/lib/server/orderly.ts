/**
 * Orderly / QuickPerps client (vendored from @midas/exchange, verified on
 * testnet). ed25519 request signing + account onboarding (register + add key).
 * broker_id defaults to quick_perps (QuickSwap's QuickPerps on Orderly).
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import bs58 from "bs58";
import { keccak256, encodePacked, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const BROKER_ID = process.env.ORDERLY_BROKER_ID || "quick_perps";
export const ORDERLY_BASE = process.env.ORDERLY_BASE_URL || "https://testnet-api-evm.orderly.org";
const VERIFYING = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";

function hexToBytes(hex: string): Uint8Array {
  const c = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(c.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export function generateOrderlyKey() {
  const secret = ed.utils.randomPrivateKey();
  return { secretHex: Buffer.from(secret).toString("hex"), orderlyKey: `ed25519:${bs58.encode(ed.getPublicKey(secret))}` };
}

function signHeaders(creds: { accountId: string; orderlyKey: string; secretHex: string }, method: string, path: string, body = "") {
  const ts = Date.now();
  const msg = `${ts}${method.toUpperCase()}${path}${body}`;
  const sig = ed.sign(new TextEncoder().encode(msg), hexToBytes(creds.secretHex));
  return {
    "orderly-timestamp": String(ts),
    "orderly-account-id": creds.accountId,
    "orderly-key": creds.orderlyKey,
    "orderly-signature": b64url(sig),
  };
}

export interface OrderlyCreds { accountId: string; orderlyKey: string; secretHex: string; baseUrl?: string }

export class OrderlyClient {
  private base: string;
  constructor(private creds: OrderlyCreds) { this.base = creds.baseUrl || ORDERLY_BASE; }
  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    const headers = { ...signHeaders(this.creds, method, path, bodyStr), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
    const res = await fetch(`${this.base}${path}`, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { success?: boolean; data?: T; message?: string; code?: number };
    if (!res.ok || json.success === false) throw new Error(`Orderly ${method} ${path}: [${json.code}] ${json.message ?? res.status}`);
    return json.data as T;
  }
  getBalance() { return this.req<{ total_collateral_value: number; free_collateral: number; holding: any[] }>("GET", "/v1/client/holding"); }
  getPositions() { return this.req<{ rows: any[] }>("GET", "/v1/positions").then((d) => d.rows ?? []); }
  getOrders(status?: string) { return this.req<{ rows: any[] }>("GET", `/v1/orders${status ? `?status=${status}` : ""}`).then((d) => d.rows ?? []); }
  getStatistics() { return this.req<any>("GET", "/v1/client/statistics").catch(() => null); }
  placeOrder(p: { symbol: string; side: "BUY" | "SELL"; order_type: string; order_quantity: number; order_price?: number; reduce_only?: boolean }) {
    return this.req("POST", "/v1/order", { ...p, broker_id: BROKER_ID });
  }
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const j = (await res.json()) as any;
  if (!res.ok || j.success === false) throw new Error(`Orderly ${path}: ${j.message ?? res.status}`);
  return j.data;
}

/** Full onboarding: generate wallet + ed25519 key, register account + key. Returns creds to store. */
export async function onboardOrderly(opts: { baseUrl?: string; chainId?: number; privateKey?: `0x${string}` }) {
  const base = opts.baseUrl || ORDERLY_BASE;
  const chainId = opts.chainId || 421614; // Arbitrum Sepolia (testnet registration)
  const pk = opts.privateKey || generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const domain = { name: "Orderly", version: "1", chainId, verifyingContract: VERIFYING as `0x${string}` };

  const nonce = (await (await fetch(`${base}/v1/registration_nonce`)).json()).data.registration_nonce as string;
  const regTs = Date.now();
  const regSig = await account.signTypedData({
    domain, primaryType: "Registration",
    types: { Registration: [{ name: "brokerId", type: "string" }, { name: "chainId", type: "uint256" }, { name: "timestamp", type: "uint64" }, { name: "registrationNonce", type: "uint256" }] },
    message: { brokerId: BROKER_ID, chainId: BigInt(chainId), timestamp: BigInt(regTs), registrationNonce: BigInt(nonce) },
  });
  const regData = await post(base, "/v1/register_account", { message: { brokerId: BROKER_ID, chainId, timestamp: regTs, registrationNonce: nonce }, signature: regSig, userAddress: account.address });
  const accountId: string = regData?.account_id ?? keccak256(encodePacked(["address", "bytes32"], [account.address, keccak256(toBytes(BROKER_ID))]));

  const key = generateOrderlyKey();
  const keyTs = Date.now();
  const exp = keyTs + 1000 * 60 * 60 * 24 * 365;
  const keySig = await account.signTypedData({
    domain, primaryType: "AddOrderlyKey",
    types: { AddOrderlyKey: [{ name: "brokerId", type: "string" }, { name: "chainId", type: "uint256" }, { name: "orderlyKey", type: "string" }, { name: "scope", type: "string" }, { name: "timestamp", type: "uint64" }, { name: "expiration", type: "uint64" }] },
    message: { brokerId: BROKER_ID, chainId: BigInt(chainId), orderlyKey: key.orderlyKey, scope: "read,trading", timestamp: BigInt(keyTs), expiration: BigInt(exp) },
  });
  await post(base, "/v1/orderly_key", { message: { brokerId: BROKER_ID, chainId, orderlyKey: key.orderlyKey, scope: "read,trading", timestamp: keyTs, expiration: exp }, signature: keySig, userAddress: account.address });

  return { address: account.address, privateKey: pk, accountId, orderlyKey: key.orderlyKey, secretHex: key.secretHex, baseUrl: base };
}
