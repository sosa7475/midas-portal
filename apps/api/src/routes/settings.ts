import { Router } from "express";
import { SaveApiKeyRequest, LlmProvider } from "@midas/shared";
import { query } from "../db";
import { authenticate, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { decrypt, encrypt } from "../services/encryption";

const router = Router();
router.use(authenticate);

/** Load the user's BYO LLM key (decrypted) if they saved one. */
export async function getUserLlmKey(
  userId: string
): Promise<{ provider: "openai" | "anthropic"; apiKey: string } | null> {
  const result = await query(
    `SELECT provider, encrypted_key FROM api_keys
     WHERE user_id = $1 AND provider IN ('anthropic', 'openai') LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { provider: row.provider, apiKey: decrypt(row.encrypted_key) };
}

router.post("/api-key", validateBody(SaveApiKeyRequest), async (req, res) => {
  const { provider, apiKey } = req.body as SaveApiKeyRequest;
  try {
    const encryptedKey = encrypt(apiKey);
    await query(
      `INSERT INTO api_keys (user_id, provider, encrypted_key, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = $3`,
      [(req as AuthedRequest).user.userId, provider, encryptedKey, `${provider} API`]
    );
    res.json({ saved: true, provider });
  } catch (err) {
    console.error("Save API key error:", err);
    res.status(500).json({ error: "Failed to save API key" });
  }
});

// Key values are never returned.
router.get("/api-keys", async (req, res) => {
  try {
    const result = await query(
      `SELECT provider, label, created_at FROM api_keys
       WHERE user_id = $1 AND provider IN ('anthropic', 'openai')`,
      [(req as AuthedRequest).user.userId]
    );
    res.json({
      providers: result.rows.map((r) => ({
        provider: r.provider,
        label: r.label,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

router.delete("/api-key/:provider", async (req, res) => {
  const parsed = LlmProvider.safeParse(req.params.provider);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider" });
  try {
    await query("DELETE FROM api_keys WHERE user_id = $1 AND provider = $2", [
      (req as unknown as AuthedRequest).user.userId,
      parsed.data,
    ]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

export default router;
