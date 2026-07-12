import { Pool } from "pg";
import { env, IS_PROD } from "./env";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("Database pool error:", err);
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
