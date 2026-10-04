#!/usr/bin/env node
/**
 * Orderly onboarding CLI — creates a Midas trading account (wallet + ed25519
 * orderly-key), registers it, and prints the env vars to store.
 *
 *   pnpm --filter @midas/mcp onboard                    # testnet, fresh wallet
 *   ORDERLY_PRIVATE_KEY=0x.. pnpm --filter @midas/mcp onboard   # use your wallet
 *   MIDAS_NETWORK=mainnet ... onboard                   # mainnet (real funds)
 *
 * Keys are printed to your terminal only — never sent through the agent.
 */
import { onboard } from "@midas/exchange";

const NETWORK = process.env.MIDAS_NETWORK === "mainnet" ? "mainnet" : "testnet";
const BASE =
  process.env.ORDERLY_BASE_URL ||
  (NETWORK === "mainnet" ? "https://api-evm.orderly.org" : "https://testnet-api-evm.orderly.org");
const BROKER = process.env.ORDERLY_BROKER_ID || "woofi_pro";
const CHAIN = Number(process.env.ORDERLY_CHAIN_ID || (NETWORK === "mainnet" ? 42161 : 421614));

async function main() {
  console.error(`Onboarding a Midas trading account on Orderly ${NETWORK} (broker ${BROKER}, chain ${CHAIN})…`);
  const r = await onboard({
    baseUrl: BASE,
    brokerId: BROKER,
    chainId: CHAIN,
    privateKey: process.env.ORDERLY_PRIVATE_KEY as `0x${string}` | undefined,
  });

  console.error("\n✅ Account registered + ed25519 key added. Store these securely:\n");
  console.log(`# --- Midas / Orderly ${NETWORK} credentials ---`);
  console.log(`ORDERLY_BASE_URL=${BASE}`);
  console.log(`ORDERLY_ACCOUNT_ID=${r.accountId}`);
  console.log(`ORDERLY_KEY=${r.orderlyKey}`);
  console.log(`ORDERLY_SECRET_HEX=${r.orderlySecretHex}`);
  console.log(`# Wallet (fund this address with USDC collateral):`);
  console.log(`ORDERLY_WALLET_ADDRESS=${r.address}`);
  console.log(`ORDERLY_PRIVATE_KEY=${r.privateKey}`);
  console.error(
    `\nNext: deposit USDC collateral to ${r.address} on ${NETWORK} ` +
      `(${NETWORK === "testnet" ? "Orderly testnet faucet" : "bridge/deposit real USDC"}), ` +
      `then set MIDAS_TRADING_ENABLED=true to arm live orders.`
  );
}

main().catch((e) => {
  console.error("Onboarding failed:", e.message);
  process.exit(1);
});
