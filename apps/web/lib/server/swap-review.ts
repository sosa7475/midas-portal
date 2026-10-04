/** Enforce reviewed bounds before any signing; this module is pure and has no execution client. */
export function assertReviewCurrent(validUntilMs?: number, now = Date.now()) {
  if (validUntilMs !== undefined && (!Number.isFinite(validUntilMs) || now >= validUntilMs)) throw new Error("Reviewed idea expired; obtain a new proposal");
}
export function reviewedSwapMinimum(quoted: bigint, routeMinimum: bigint, reviewed?: string) {
  if (reviewed === undefined) return routeMinimum;
  if (!/^[1-9][0-9]*$/.test(reviewed)) throw new Error("Invalid reviewed output minimum");
  const floor = BigInt(reviewed);
  if (quoted < floor) throw new Error("Current quote is below the reviewed minimum; obtain a new proposal");
  return floor > routeMinimum ? floor : routeMinimum;
}
