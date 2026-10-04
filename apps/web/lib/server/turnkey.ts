/**
 * Turnkey — agent key infrastructure. Enclave-secured keys we never hold; every signature
 * is policy-checked and revocable. One system signs for EVM (Hood Chain, Base, Arbitrum,
 * Hyperliquid) and Solana.
 *
 * Security model (PROVEN LIVE):
 *  - each agent = its own sub-organization + wallet (EVM secp256k1 + Solana ed25519)
 *  - the agent signs with a DEDICATED, non-root (default-deny) API key we store encrypted
 *  - a TRADE-ONLY policy allows SIGN_TRANSACTION only to allow-listed routers →
 *    a withdrawal to any other address is DENIED in the enclave. Verified: swap allowed,
 *    withdrawal denied ("insufficient permissions").
 *  - revocation: delete the agent's policy/user via our root key.
 */
import {swapPolicyCondition} from "./signing-policy";
import {CHAINS} from "./dex";
import { Turnkey } from "@turnkey/sdk-server";
import { generateP256KeyPair } from "@turnkey/crypto";
import { encodeFunctionData, maxUint256 } from "viem";

export function turnkeyReady(): boolean {
  return !!(process.env.TURNKEY_ORGANIZATION_ID && process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_API_PRIVATE_KEY);
}

// Trade-only allow-list: DEX routers the agent may swap on. Extend per chain as we add them.
export const EVM_ROUTERS = [
  "0x2626664c2603336e57b271c5c0b26f421741e481", // Uniswap SwapRouter02 (Base)
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap SwapRouter02 (Ethereum / Arbitrum / Optimism)
  "0xcaf681a66d020601342297493863e78c959e5cb2", // Uniswap SwapRouter02 (Robinhood Chain)
];

const APPROVE_ABI = [{ name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }] as const;

/** Trade-only policy: allow swaps TO a router, and approve only the approved router on ANY token — nothing else.
 *  approve only the approved router calldata is identical regardless of token, so one clause covers all tokens. */
function tradeOnlyCondition(routers: string[],owner:string): string {
  const rl = routers.map((r) => `'${r.toLowerCase()}'`).join(", ");
  const approveData = routers.map((r) => `'${encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [r as `0x${string}`, maxUint256] }).toLowerCase()}'`).join(", ");
  const routes=Object.values(CHAINS).filter(c=>routers.map(r=>r.toLowerCase()).includes(c.router.toLowerCase())).map(c=>({chainId:c.id,router:c.router}));
  const approvals=routes.map(r=>`(eth.tx.chain_id == ${r.chainId} && eth.tx.value == 0 && eth.tx.data[0..10] == '0x095ea7b3' && eth.tx.data[10..74] == '${r.router.toLowerCase().slice(2).padStart(64,"0")}')`).join(" || ");
  return `(${swapPolicyCondition(routes,owner)}) || (activity.kind == 'SIGN_TRANSACTION' && (${approvals}))`;
}

const BASE = () => process.env.TURNKEY_BASE_URL || "https://api.turnkey.com";

/** Root (platform) client — full control; used to provision + manage + revoke. */
let _root: ReturnType<Turnkey["apiClient"]> | null = null;
export function tkRoot() {
  if (!turnkeyReady()) throw new Error("Turnkey is not configured (missing TURNKEY_* env vars).");
  if (!_root) _root = new Turnkey({ apiBaseUrl: BASE(), apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!, apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!, defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID! }).apiClient();
  return _root;
}

/** A client stamped as the AGENT's restricted key (policy-enforced). */
export function tkAgent(subOrgId: string, apiPublicKey: string, apiPrivateKey: string) {
  return new Turnkey({ apiBaseUrl: BASE(), apiPublicKey, apiPrivateKey, defaultOrganizationId: subOrgId }).apiClient();
}

export async function tkWhoami() {
  const w = await tkRoot().getWhoami({ organizationId: process.env.TURNKEY_ORGANIZATION_ID! });
  return { organizationId: w.organizationId, userId: w.userId, username: w.username };
}

export interface AgentKeyset {
  subOrgId: string;
  evmAddress: string;
  solAddress: string;
  agentUserId: string;
  agentApiPublicKey: string;
  agentApiPrivateKey: string; // caller encrypts + stores this (per-agent, trade-only)
  policyId: string;
}

/**
 * Provision a dedicated, trade-only agent keyset: sub-org + wallet + non-root agent user
 * + a policy that only permits signing transactions to allow-listed routers.
 * `routers` = lowercased contract addresses the agent may transact with (DEX/venue routers).
 */
export async function provisionAgentKeyset(label: string, routers: string[]): Promise<AgentKeyset> {
  const root = tkRoot();
  const agentKp = generateP256KeyPair();

  const sub = await root.createSubOrganization({
    subOrganizationName: `${label}-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [{ userName: "platform", apiKeys: [{ apiKeyName: "platform", publicKey: process.env.TURNKEY_API_PUBLIC_KEY!, curveType: "API_KEY_CURVE_P256" }], authenticators: [], oauthProviders: [] }],
    wallet: { walletName: `${label}-wallet`, accounts: [
      { curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" },
      { curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/501'/0'/0'", addressFormat: "ADDRESS_FORMAT_SOLANA" },
    ] },
  });
  const subOrgId = sub.subOrganizationId;
  const [evmAddress, solAddress] = sub.wallet!.addresses;

  const u = await root.createUsers({ organizationId: subOrgId, users: [{ userName: "agent", userTags: [], apiKeys: [{ apiKeyName: "agent-key", publicKey: agentKp.publicKey, curveType: "API_KEY_CURVE_P256" }], authenticators: [], oauthProviders: [] }] });
  const agentUserId = u.userIds[0];

  const p = await root.createPolicy({
    organizationId: subOrgId, policyName: "trade-only", effect: "EFFECT_ALLOW",
    consensus: "approvers.count() >= 1",
    condition: tradeOnlyCondition(routers,evmAddress),
    notes: "Agent may only swap on allow-listed routers and approve only the approved router. Transfers/withdrawals denied.",
  });

  return { subOrgId, evmAddress, solAddress, agentUserId, agentApiPublicKey: agentKp.publicKey, agentApiPrivateKey: agentKp.privateKey, policyId: p.policyId };
}

/**
 * Personal spending wallet (Midas Bank): a Turnkey sub-org + wallet the USER controls.
 * No trade-only policy — sends go anywhere, but only when the authenticated owner requests
 * them (root-signed server-side). One per user. EVM (Base) + Solana.
 */
export async function provisionPersonalWallet(label: string): Promise<{ subOrgId: string; evmAddress: string; solAddress: string }> {
  const root = tkRoot();
  const sub = await root.createSubOrganization({
    subOrganizationName: `${label}-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [{ userName: "platform", apiKeys: [{ apiKeyName: "platform", publicKey: process.env.TURNKEY_API_PUBLIC_KEY!, curveType: "API_KEY_CURVE_P256" }], authenticators: [], oauthProviders: [] }],
    wallet: { walletName: `${label}-wallet`, accounts: [
      { curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" },
      { curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/501'/0'/0'", addressFormat: "ADDRESS_FORMAT_SOLANA" },
    ] },
  });
  const [evmAddress, solAddress] = sub.wallet!.addresses;
  return { subOrgId: sub.subOrganizationId, evmAddress, solAddress };
}

/**
 * Sign a transaction with the PLATFORM ROOT key (owns every sub-org). Root bypasses the
 * agent's trade-only policy — used ONLY for user-authorized withdrawals to the owner's
 * address (never exposed to the agent/LLM). Returns the signed serialized tx.
 */
export async function rootSignEvmTx(subOrgId: string, evmAddress: string, unsignedTxHex: string): Promise<string> {
  if(process.env.MIDAS_WITHDRAWALS_ENABLED!=="true")throw new Error("Withdrawals are disabled on this service; use the isolated owner-authorized withdrawal service");
  const r = await tkRoot().signTransaction({
    organizationId: subOrgId, signWith: evmAddress,
    unsignedTransaction: unsignedTxHex.startsWith("0x") ? unsignedTxHex.slice(2) : unsignedTxHex,
    type: "TRANSACTION_TYPE_ETHEREUM",
  });
  return r.signedTransaction;
}

/**
 * Add a fresh trade-only policy to an EXISTING sub-org so agents provisioned earlier gain
 * newly-added chains' routers. Legacy trade-only policies are removed after the replacement is created.
 */
export async function addRouterPolicy(subOrgId: string, routers: string[],evmAddress:string): Promise<string> {
  const p = await tkRoot().createPolicy({
    organizationId: subOrgId, policyName: `trade-only-${Date.now()}`, effect: "EFFECT_ALLOW",
    consensus: "approvers.count() >= 1",
    condition: tradeOnlyCondition(routers,evmAddress),
    notes: "Restrict swaps + approve only the approved router on the current multi-chain router set.",
  });
  const existing=await tkRoot().getPolicies({organizationId:subOrgId});
  for(const old of existing.policies)if(old.policyId!==p.policyId && old.policyName.startsWith("trade-only"))await tkRoot().deletePolicy({organizationId:subOrgId,policyId:old.policyId});
  return p.policyId;
}

/** Revoke an agent's signing ability (delete its trade-only policy → default-deny takes over). */
export async function revokeAgentPolicy(subOrgId: string, policyId: string) {
  await tkRoot().deletePolicy({ organizationId: subOrgId, policyId });
}

/** Sign an unsigned EVM transaction with the agent's key (policy-enforced). type=ETHEREUM covers Hood Chain/Base/Arbitrum. */
export async function agentSignEvmTx(subOrgId: string, apiPublicKey: string, apiPrivateKey: string, signWith: string, unsignedTxHex: string) {
  const tx = unsignedTxHex.startsWith("0x") ? unsignedTxHex.slice(2) : unsignedTxHex;
  const r = await tkAgent(subOrgId, apiPublicKey, apiPrivateKey).signTransaction({ signWith, unsignedTransaction: tx, type: "TRANSACTION_TYPE_ETHEREUM" });
  return r.signedTransaction;
}

/** Sign an unsigned Solana transaction with the agent's key. */
export async function agentSignSolanaTx(subOrgId: string, apiPublicKey: string, apiPrivateKey: string, signWith: string, unsignedTxHex: string) {
  const r = await tkAgent(subOrgId, apiPublicKey, apiPrivateKey).signTransaction({ signWith, unsignedTransaction: unsignedTxHex, type: "TRANSACTION_TYPE_SOLANA" });
  return r.signedTransaction;
}

/** Sign a raw digest (EIP-712 message, e.g. Hyperliquid orders) with the agent's EVM key. Returns {r,s,v}. */
export async function agentSignEvmDigest(subOrgId: string, apiPublicKey: string, apiPrivateKey: string, signWith: string, digestHex: string) {
  const payload = digestHex.startsWith("0x") ? digestHex : `0x${digestHex}`;
  const sig = await tkAgent(subOrgId, apiPublicKey, apiPrivateKey).signRawPayload({ signWith, payload, encoding: "PAYLOAD_ENCODING_HEXADECIMAL", hashFunction: "HASH_FUNCTION_NO_OP" });
  return { r: sig.r, s: sig.s, v: sig.v };
}
