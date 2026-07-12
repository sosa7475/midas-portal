/**
 * Environment validation — fail fast on missing/default secrets (BUILD_SPEC §5).
 * The process refuses to boot in production with weak or absent security config.
 */
import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .refine((v) => !/^(your-|change|secret|test)/i.test(v), "JWT_SECRET looks like a placeholder"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .refine((v) => !/^0+$/.test(v), "ENCRYPTION_KEY must not be all zeros"),

  ALLOWED_ORIGINS: z.string().optional(), // comma-separated browser origins

  // LLM
  ACTIVE_LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  // Orderly
  ORDERLY_BASE_URL: z.string().url().default("https://testnet-api-evm.orderly.org"),
  ORDERLY_BROKER_ID: z.string().default("midas_portal"),

  // Uploads — on Fly this is a mounted volume (e.g. /data/uploads)
  UPLOAD_DIR: z.string().default(isProd ? "/data/uploads" : "./uploads"),
  MAX_FILE_SIZE: z.coerce.number().default(10 * 1024 * 1024),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("FATAL: invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const IS_PROD = env.NODE_ENV === "production";
