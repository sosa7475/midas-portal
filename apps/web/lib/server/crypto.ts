import crypto from "crypto";

// AES-256-GCM for user secrets at rest. ENCRYPTION_KEY = 64 hex chars (32 bytes).
// Fail CLOSED: never encrypt/decrypt with a missing or weak key.
function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex) || /^0+$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY missing or invalid (need 64 non-zero hex chars)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
