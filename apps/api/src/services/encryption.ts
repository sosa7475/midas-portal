/**
 * AES-256-GCM authenticated encryption for stored user secrets.
 * Replaces the MVP's CBC (no integrity) + default-zero key — env.ts enforces a
 * real 32-byte key before boot.
 *
 * Format: v2:<iv hex>:<authTag hex>:<ciphertext hex>
 * Legacy CBC values (iv:ciphertext) are still decryptable for migration.
 */
import crypto from "crypto";
import { env } from "../env";

const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(payload: string): string {
  if (payload.startsWith("v2:")) {
    const [, ivHex, tagHex, dataHex] = payload.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }
  // Legacy CBC (MVP format) — support reads so existing rows can be re-encrypted.
  const [ivHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, Buffer.from(ivHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
