/**
 * Upload storage — writes to UPLOAD_DIR, which on Fly is a mounted volume
 * (persistent across deploys). Filenames are server-generated; user input never
 * touches the path (no traversal).
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { env } from "../env";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const ALLOWED_IMAGE_MIMES = Object.keys(EXT_BY_MIME);

export async function ensureUploadDir() {
  await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
}

/** Persist an uploaded image buffer; returns the public path (served at /uploads). */
export async function saveImage(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);
  const name = `${crypto.randomUUID()}${ext}`;
  await fs.writeFile(path.join(env.UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}
