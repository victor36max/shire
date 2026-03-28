#!/usr/bin/env bun
/**
 * Build standalone binaries for all supported platforms.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts          # Build all platforms
 *   bun run scripts/build-binaries.ts local     # Build for current platform only
 */
import { $ } from "bun";
import { cpSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");

interface Target {
  bunTarget: string;
  npmDir: string;
  binaryName: string;
}

const TARGETS: Target[] = [
  { bunTarget: "bun-darwin-arm64", npmDir: "darwin-arm64", binaryName: "shire" },
  { bunTarget: "bun-darwin-x64", npmDir: "darwin-x64", binaryName: "shire" },
  { bunTarget: "bun-linux-x64", npmDir: "linux-x64", binaryName: "shire" },
  { bunTarget: "bun-linux-arm64", npmDir: "linux-arm64", binaryName: "shire" },
  { bunTarget: "bun-windows-x64", npmDir: "win32-x64", binaryName: "shire.exe" },
];

function getCurrentTarget(): Target | undefined {
  const platform = process.platform;
  const arch = process.arch;
  const key = `${platform}-${arch}`;
  return TARGETS.find((t) => t.npmDir === key);
}

async function buildBinary(target: Target): Promise<void> {
  const outDir = join(ROOT, "npm", target.npmDir);
  const outFile = join(outDir, target.binaryName);

  console.log(`Building ${target.bunTarget} → npm/${target.npmDir}/${target.binaryName}`);

  // bun build --compile handles HTML imports automatically — it bundles
  // the frontend (JS, CSS, assets) into the binary via the manifest
  await $`bun build src/cli.ts --compile --target=${target.bunTarget} --outfile=${outFile}`.cwd(
    ROOT,
  );

  // Copy migrations (needed at runtime, not bundled by bun build)
  const drizzleSrc = join(ROOT, "drizzle");
  const drizzleDest = join(outDir, "drizzle");
  mkdirSync(drizzleDest, { recursive: true });
  cpSync(drizzleSrc, drizzleDest, { recursive: true });

  console.log(`  Done: ${target.npmDir}`);
}

async function main(): Promise<void> {
  const localOnly = process.argv.includes("local");

  if (localOnly) {
    const current = getCurrentTarget();
    if (!current) {
      console.error(`No target for current platform: ${process.platform}-${process.arch}`);
      process.exit(1);
    }
    await buildBinary(current);
  } else {
    for (const target of TARGETS) {
      await buildBinary(target);
    }
  }

  console.log("\nBuild complete!");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
