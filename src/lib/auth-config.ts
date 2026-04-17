import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL = 30 * 24 * 3600;

let cachedSecret: string | null = null;

export function isAuthEnabled(): boolean {
  return !!process.env.SHIRE_USERNAME;
}

export function getCredentials(): { username: string; password: string } | null {
  const username = process.env.SHIRE_USERNAME;
  if (!username) return null;
  const password = process.env.SHIRE_PASSWORD;
  if (!password) {
    throw new Error("SHIRE_PASSWORD must be set when SHIRE_USERNAME is set");
  }
  return { username, password };
}

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const dataDir = process.env.SHIRE_DATA_DIR || join(homedir(), ".shire");
  const secretPath = join(dataDir, ".jwt-secret");

  try {
    cachedSecret = readFileSync(secretPath, "utf-8").trim();
    return cachedSecret;
  } catch {
    mkdirSync(dataDir, { recursive: true });
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    writeFileSync(secretPath, hex, { mode: 0o600 });
    cachedSecret = hex;
    return hex;
  }
}

export function resetCachedSecret(): void {
  cachedSecret = null;
}
