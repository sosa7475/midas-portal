import { Pool } from "pg";

// Neon Postgres. One pooled client reused across warm serverless invocations.
declare global {
  // eslint-disable-next-line no-var
  var _midasPool: Pool | undefined;
}

export const pool =
  global._midasPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") global._midasPool = pool;

export async function query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
  return pool.query(text, params) as unknown as Promise<{ rows: T[] }>;
}
