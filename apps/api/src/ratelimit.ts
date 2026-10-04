/**
 * Postgres-backed rate limiting — no Redis, no third-party service.
 *
 * Rate limiting is a security control (brute-force + order-spam protection), so
 * it must be durable and correct across multiple Fly machines. A single atomic
 * upsert per request gives a fixed-window counter shared by all machines via the
 * database we already run.
 *
 * Fail-open: a limiter DB error must never take the API down — it logs and allows.
 */
import type { NextFunction, Request, Response } from "express";
import { query } from "./db";

interface RateLimitOptions {
  tokens: number;
  windowSec: number;
  keyPrefix: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Prefer authenticated user id; fall back to client IP (Fly sets Fly-Client-IP).
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    const ip = (req.headers["fly-client-ip"] as string) ?? req.ip ?? "unknown";
    const key = `${opts.keyPrefix}:${userId ?? ip}`;

    try {
      // Atomic fixed-window: reset the counter when the window has elapsed,
      // otherwise increment. RETURNING gives us the post-update count.
      const result = await query(
        `INSERT INTO rate_limits (key, count, window_start)
         VALUES ($1, 1, NOW())
         ON CONFLICT (key) DO UPDATE SET
           count = CASE
             WHEN rate_limits.window_start < NOW() - ($2 || ' seconds')::interval THEN 1
             ELSE rate_limits.count + 1
           END,
           window_start = CASE
             WHEN rate_limits.window_start < NOW() - ($2 || ' seconds')::interval THEN NOW()
             ELSE rate_limits.window_start
           END
         RETURNING count`,
        [key, opts.windowSec]
      );

      const count = Number(result.rows[0]?.count ?? 1);
      if (count > opts.tokens) {
        res.setHeader("Retry-After", String(opts.windowSec));
        return res.status(429).json({ error: "Too many requests" });
      }
      next();
    } catch (err) {
      console.error("Rate limiter error (failing open):", err);
      next();
    }
  };
}
