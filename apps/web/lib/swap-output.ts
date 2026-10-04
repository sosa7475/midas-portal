/** Display the ERC20 asset delivered by the current direct-output swap route. */
export function swapOutput(requested: unknown, resolved?: string, wrappedNative?: string) {
  const token = String(requested ?? "").trim();
  const wrapped = ["eth", "weth"].includes(token.toLowerCase()) ||
    !!(resolved && wrappedNative && resolved.toLowerCase() === wrappedNative.toLowerCase());
  return {
    tokenOutLabel: wrapped ? "WETH" : token.startsWith("0x") ? token : token.toUpperCase(),
    outputNote: wrapped ? "You receive wrapped ETH (WETH). Native ETH is still needed for network fees." : null,
  };
}
