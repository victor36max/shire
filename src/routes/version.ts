import { Hono } from "hono";
import type { AppEnv } from "../types";

declare const __SHIRE_VERSION__: string;
const CURRENT_VERSION = typeof __SHIRE_VERSION__ !== "undefined" ? __SHIRE_VERSION__ : "0.1.0-dev";
const NPM_PACKAGE = "agents-shire";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached: { version: string; checkedAt: number } | null = null;

function isNewer(latest: string, current: string): boolean {
  if (current.includes("-")) return false;
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | null> {
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.version;
  }
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
    if (!res.ok) return cached?.version ?? null;
    const data = (await res.json()) as { version: string };
    cached = { version: data.version, checkedAt: Date.now() };
    return data.version;
  } catch {
    return cached?.version ?? null;
  }
}

export const versionRoutes = new Hono<AppEnv>().get("/version", async (c) => {
  const latest = await fetchLatestVersion();
  return c.json({
    current: CURRENT_VERSION,
    latest,
    updateAvailable: latest ? isNewer(latest, CURRENT_VERSION) : false,
    upgradeCommand: "npm install -g agents-shire@latest",
  });
});

/** Exported for testing */
export { isNewer, CURRENT_VERSION };

/** Reset the cache (for testing) */
export function resetVersionCache(): void {
  cached = null;
}
