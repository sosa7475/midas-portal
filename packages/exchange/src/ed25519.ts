/**
 * Orderly ed25519 request signing — the correct scheme (replaces the MVP's HMAC).
 *
 * Each request signs `${timestamp}${METHOD}${path}${body}` with the account's
 * ed25519 "orderly-key" secret; the base64url signature + the base58 public key
 * go in the orderly-* headers. This is what Orderly actually validates.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import bs58 from "bs58";

// @noble/ed25519 v2 needs a sync sha512 to expose sync sign/getPublicKey.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface OrderlyKeyPair {
  /** 32-byte ed25519 secret, hex (store encrypted). */
  secretHex: string;
  /** "ed25519:<base58 pubkey>" — the orderly-key id sent in headers + registration. */
  orderlyKey: string;
}

export function generateOrderlyKey(): OrderlyKeyPair {
  const secret = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(secret);
  return {
    secretHex: Buffer.from(secret).toString("hex"),
    orderlyKey: `ed25519:${bs58.encode(pub)}`,
  };
}

export function orderlyKeyFromSecret(secretHex: string): string {
  const pub = ed.getPublicKey(hexToBytes(secretHex));
  return `ed25519:${bs58.encode(pub)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** The exact message Orderly signs: timestamp + METHOD + path(+query) + body. */
export function buildSignatureMessage(
  timestamp: number,
  method: string,
  path: string,
  body = ""
): string {
  return `${timestamp}${method.toUpperCase()}${path}${body}`;
}

export interface SignedHeaders {
  "orderly-timestamp": string;
  "orderly-account-id": string;
  "orderly-key": string;
  "orderly-signature": string;
}

export function signRequest(params: {
  secretHex: string;
  accountId: string;
  orderlyKey: string;
  timestamp: number;
  method: string;
  path: string;
  body?: string;
}): SignedHeaders {
  const message = buildSignatureMessage(
    params.timestamp,
    params.method,
    params.path,
    params.body ?? ""
  );
  const sig = ed.sign(new TextEncoder().encode(message), hexToBytes(params.secretHex));
  return {
    "orderly-timestamp": String(params.timestamp),
    "orderly-account-id": params.accountId,
    "orderly-key": params.orderlyKey,
    "orderly-signature": base64url(sig),
  };
}
