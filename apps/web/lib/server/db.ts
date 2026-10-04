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
    ssl: { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") global._midasPool = pool;

export async function query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
  return pool.query(text, params) as unknown as Promise<{ rows: T[] }>;
}

/** Keep all transactional work on one connection. */
export async function transaction<T>(work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
