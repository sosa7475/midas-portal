import { Router } from "express";
import { ConnectWalletRequest } from "@midas/shared";
import { query } from "../db";
import { authenticate, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { decrypt, encrypt } from "../services/encryption";
import * as orderly from "../services/orderly";

const router = Router();
router.use(authenticate);

export async function getUserOrderlyCreds(
  userId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const result = await query(
    "SELECT encrypted_key, encrypted_secret FROM api_keys WHERE user_id = $1 AND provider = 'orderly'",
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { apiKey: decrypt(row.encrypted_key), apiSecret: decrypt(row.encrypted_secret) };
}

router.post("/connect", validateBody(ConnectWalletRequest), async (req, res) => {
  const { apiKey, apiSecret } = req.body as ConnectWalletRequest;
  const userId = (req as AuthedRequest).user.userId;
  try {
    // Validate the credentials against Orderly BEFORE persisting.
    const balance = await orderly.getBalance(apiKey, apiSecret);

    await query(
      `INSERT INTO api_keys (user_id, provider, encrypted_key, encrypted_secret, label)
       VALUES ($1, 'orderly', $2, $3, 'Orderly API')
       ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = $2, encrypted_secret = $3`,
      [userId, encrypt(apiKey), encrypt(apiSecret)]
    );
    res.json({ connected: true, balance });
  } catch (err) {
    console.error("Wallet connect error:", err);
    res.status(400).json({
      error: "Could not verify Orderly credentials. Check your API key and secret.",
    });
  }
});

router.get("/balance", async (req, res) => {
  try {
    const creds = await getUserOrderlyCreds((req as AuthedRequest).user.userId);
    if (!creds) {
      return res
        .status(400)
        .json({ error: "No Orderly credentials found. Please connect your wallet first." });
    }
    const balance = await orderly.getBalance(creds.apiKey, creds.apiSecret);
    res.json(balance);
  } catch (err) {
    console.error("Balance error:", err);
    res.status(502).json({ error: "Failed to fetch balance from Orderly" });
  }
});

export default router;
