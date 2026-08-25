/**
 * Orderly account onboarding (non-custodial): derive account id, register the
 * account, and register an ed25519 orderly-key — all via EIP-712 wallet
 * signatures (no gas). Depositing collateral is a separate on-chain step.
 *
 * NOTE: the EIP-712 verifying contract + default chain are Orderly constants;
 * they're overridable so they can be corrected against Orderly's current docs.
 */
import { keccak256, encodePacked, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { generateOrderlyKey, type OrderlyKeyPair } from "./ed25519.js";

/**
 * Orderly off-chain EIP-712 verifying contract — a sentinel (all-C's) because
 * registration/key-add are verified off-chain by Orderly, not by a real contract.
 */
export const ORDERLY_VERIFYING_CONTRACT = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";

export interface OnboardConfig {
  baseUrl: string;
  brokerId: string;
  /** EIP-712 chainId. Testnet default: Arbitrum Sepolia (421614). */
  chainId: number;
  /** Existing wallet private key (0x…). Omit to generate a fresh one. */
  privateKey?: `0x${string}`;
}

export interface OnboardResult {
  address: string;
  privateKey: string;
  accountId: string;
  orderlyKey: string;
  orderlySecretHex: string;
}

/** account_id = keccak256(pack(address, keccak256(brokerId))). */
export function deriveAccountId(address: string, brokerId: string): string {
  const brokerHash = keccak256(toBytes(brokerId));
  return keccak256(
    encodePacked(["address", "bytes32"], [address as `0x${string}`, brokerHash])
  );
}

function domain(chainId: number) {
  return {
    name: "Orderly",
    version: "1",
    chainId,
    verifyingContract: ORDERLY_VERIFYING_CONTRACT as `0x${string}`,
  };
}

async function post(baseUrl: string, path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { success?: boolean; data?: any; message?: string };
  if (!res.ok || json.success === false) {
    throw new Error(`Orderly ${path} failed: ${json.message ?? res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.data;
}

async function getNonce(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/registration_nonce`, { signal: AbortSignal.timeout(10_000) });
  const json = (await res.json()) as { data?: { registration_nonce?: string } };
  const nonce = json.data?.registration_nonce;
  if (!nonce) throw new Error("Could not fetch registration nonce");
  return nonce;
}

/** Full onboarding: register account + orderly-key. Returns everything to store (encrypted). */
export async function onboard(cfg: OnboardConfig): Promise<OnboardResult> {
  const pk = cfg.privateKey ?? generatePrivateKey();
  const account = privateKeyToAccount(pk);

  // 1) Register the account. Sign with bigints (uint256/uint64); POST JSON-friendly.
  const registrationNonce = await getNonce(cfg.baseUrl);
  const regTimestamp = Date.now();
  const regSignature = await account.signTypedData({
    domain: domain(cfg.chainId),
    types: {
      Registration: [
        { name: "brokerId", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "timestamp", type: "uint64" },
        { name: "registrationNonce", type: "uint256" },
      ],
    },
    primaryType: "Registration",
    message: {
      brokerId: cfg.brokerId,
      chainId: BigInt(cfg.chainId),
      timestamp: BigInt(regTimestamp),
      registrationNonce: BigInt(registrationNonce),
    },
  });
  const regData = await post(cfg.baseUrl, "/v1/register_account", {
    message: {
      brokerId: cfg.brokerId,
      chainId: cfg.chainId,
      timestamp: regTimestamp,
      registrationNonce,
    },
    signature: regSignature,
    userAddress: account.address,
  });
  // Use the account_id Orderly assigns (authoritative) over local derivation.
  const accountId: string = regData?.account_id ?? deriveAccountId(account.address, cfg.brokerId);

  // 2) Register an ed25519 orderly-key with read+trading scope.
  const key: OrderlyKeyPair = generateOrderlyKey();
  const keyTimestamp = Date.now();
  const expiration = keyTimestamp + 1000 * 60 * 60 * 24 * 365; // 1 year
  const keySignature = await account.signTypedData({
    domain: domain(cfg.chainId),
    types: {
      AddOrderlyKey: [
        { name: "brokerId", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "orderlyKey", type: "string" },
        { name: "scope", type: "string" },
        { name: "timestamp", type: "uint64" },
        { name: "expiration", type: "uint64" },
      ],
    },
    primaryType: "AddOrderlyKey",
    message: {
      brokerId: cfg.brokerId,
      chainId: BigInt(cfg.chainId),
      orderlyKey: key.orderlyKey,
      scope: "read,trading",
      timestamp: BigInt(keyTimestamp),
      expiration: BigInt(expiration),
    },
  });
  await post(cfg.baseUrl, "/v1/orderly_key", {
    message: {
      brokerId: cfg.brokerId,
      chainId: cfg.chainId,
      orderlyKey: key.orderlyKey,
      scope: "read,trading",
      timestamp: keyTimestamp,
      expiration,
    },
    signature: keySignature,
    userAddress: account.address,
  });

  return {
    address: account.address,
    privateKey: pk,
    accountId,
    orderlyKey: key.orderlyKey,
    orderlySecretHex: key.secretHex,
  };
}
