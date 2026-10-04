/**
 * Local strategy persistence for the MCP server (single-user / personal use).
 * Stored as JSON under MIDAS_DATA_DIR (default ~/.midas) — no database needed
 * for the local stdio server. The remote/Fly deployment can point this at a
 * mounted volume via MIDAS_DATA_DIR.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

const DATA_DIR = process.env.MIDAS_DATA_DIR || path.join(os.homedir(), ".midas");
const FILE = path.join(DATA_DIR, "strategy.json");

export interface StoredStrategy {
  name: string;
  rulesText: string;
  updatedAt: string;
}

export async function getStrategy(): Promise<StoredStrategy | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as StoredStrategy;
  } catch {
    return null;
  }
}

export async function setStrategy(rulesText: string, name = "My Strategy"): Promise<StoredStrategy> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const record: StoredStrategy = { name, rulesText, updatedAt: new Date().toISOString() };
  await fs.writeFile(FILE, JSON.stringify(record, null, 2));
  return record;
}
