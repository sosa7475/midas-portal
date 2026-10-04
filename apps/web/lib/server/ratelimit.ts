import type { NextRequest } from "next/server";
import { query } from "./db";

// Postgres-backed rate limiting on Neon (no Redis). Fixed window, atomic upsert.
let ensured = false;
async function ensure() {
  if (ensured) return;
  await query(`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  ensured = true;
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || req.headers.get("x-real-ip") || "unknown";
}

/** Returns true if allowed, false if the limit for `key` is exceeded. Fails closed on DB error. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    await ensure();
    const r = await query<{ count: number }>(
      `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, NOW())
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start < NOW() - ($2 || ' seconds')::interval THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < NOW() - ($2 || ' seconds')::interval THEN NOW() ELSE rate_limits.window_start END
       RETURNING count`,
      [key, windowSec]
    );
    return Number(r.rows[0]?.count ?? 1) <= limit;
  } catch {
    return false;
  }
}
