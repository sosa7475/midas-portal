/**
 * Upstash Redis: shared rate limiting across Fly machines (BUILD_SPEC Phase 1).
 * Production requires Upstash (enforced in env.ts); dev without it falls back to
 * an in-memory limiter, which is per-process and for local use only.
 */
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env";

const redis =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

function upstashLimiter(tokens: number, windowSec: number) {
  return new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(tokens, `${windowSec} s`),
    prefix: "midas:rl",
  });
}

/** Dev-only fallback (per-process). */
function memoryLimiter(tokens: number, windowSec: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    async limit(key: string) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset < now) {
        hits.set(key, { count: 1, reset: now + windowSec * 1000 });
        return { success: true };
      }
      entry.count += 1;
      return { success: entry.count <= tokens };
    },
  };
}

export function rateLimit(opts: { tokens: number; windowSec: number; keyPrefix: string }) {
  const limiter = redis
    ? upstashLimiter(opts.tokens, opts.windowSec)
    : memoryLimiter(opts.tokens, opts.windowSec);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Prefer authenticated user id; fall back to IP (Fly sets Fly-Client-IP)
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    const ip = req.headers["fly-client-ip"] ?? req.ip ?? "unknown";
    const key = `${opts.keyPrefix}:${userId ?? ip}`;
    try {
      const { success } = await limiter.limit(key);
      if (!success) return res.status(429).json({ error: "Too many requests" });
      next();
    } catch (err) {
      // Rate limiter must not take the API down; log and allow.
      console.error("Rate limiter error:", err);
      next();
    }
  };
}

export { redis };
