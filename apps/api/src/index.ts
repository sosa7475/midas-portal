/**
 * Midas Portal API — long-lived Node service on Fly.io.
 * Persistent process: real SSE streaming and (Phase 3) a persistent Orderly
 * WebSocket are native here. Do NOT reintroduce serverless assumptions.
 */
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env, IS_PROD } from "./env";
import { pool } from "./db";
import { rateLimit } from "./ratelimit";
import { ensureUploadDir } from "./services/storage";

import authRoutes from "./routes/auth";
import walletRoutes from "./routes/wallet";
import strategyRoutes from "./routes/strategy";
import tradeRoutes from "./routes/trade";
import chatRoutes from "./routes/chat";
import settingsRoutes from "./routes/settings";

const app = express();
app.set("trust proxy", true); // behind Fly proxy

app.use(helmet());

// Strict CORS: browser origins must be allowlisted; non-browser clients
// (mobile app, curl) send no Origin header and pass through.
const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!IS_PROD && /^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limits: Postgres-backed so they hold across machines (no Redis).
app.use(rateLimit({ tokens: 200, windowSec: 900, keyPrefix: "global" }));
const authLimiter = rateLimit({ tokens: 20, windowSec: 900, keyPrefix: "auth" });
const orderLimiter = rateLimit({ tokens: 30, windowSec: 900, keyPrefix: "order" });

app.use("/auth", authLimiter, authRoutes);
app.use("/wallet", walletRoutes);
app.use("/strategy", strategyRoutes);
app.use("/trade", orderLimiter, tradeRoutes);
app.use("/chat", chatRoutes);
app.use("/settings", settingsRoutes);

// Uploaded screenshots (Fly volume). Immutable server-generated names.
app.use("/uploads", express.static(env.UPLOAD_DIR, { maxAge: "1d", index: false }));

app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

// Central error handler — no stack traces to clients.
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === "Not allowed by CORS") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    console.error(err.stack ?? err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

export { app };

async function main() {
  await ensureUploadDir();
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Midas API listening on :${env.PORT} (${env.NODE_ENV})`);
    console.log(`LLM provider: ${env.ACTIVE_LLM_PROVIDER}; Orderly: ${env.ORDERLY_BASE_URL}`);
  });

  // Graceful shutdown: stop accepting, drain, close DB pool.
  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down`);
    server.close(async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Only start the listener when run directly (not when imported by a test).
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
  });
}
