#!/usr/bin/env bun
/**
 * Build standalone binaries for all supported platforms.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts                          # Build all platforms
 *   bun run scripts/build-binaries.ts local                    # Build for current platform only
 *   bun run scripts/build-binaries.ts --target bun-windows-x64 # Build a specific target (cross-compile)
 */
import tailwind from "bun-plugin-tailwind";
import { cpSync, mkdirSync } from "fs";
import { join } from "path";
import { type Target, TARGETS, getTargetByBunTarget, getCurrentTarget } from "./build-targets";

const ROOT = join(import.meta.dirname, "..");

async function buildBinary(target: Target): Promise<void> {
  const outDir = join(ROOT, "npm", target.npmDir);
  const outFile = join(outDir, target.binaryName);

  console.log(`Building ${target.bunTarget} → npm/${target.npmDir}/${target.binaryName}`);

  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", "cli.ts")],
    compile: {
      target: target.bunTarget as "bun-darwin-arm64",
      outfile: outFile,
    },
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [tailwind],
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Copy runtime assets (not bundled by bun build)
  for (const dir of ["drizzle", "catalog"]) {
    const src = join(ROOT, dir);
    const dest = join(outDir, dir);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }

  console.log(`  Done: ${target.npmDir}`);
}

async function main(): Promise<void> {
  const targetIndex = process.argv.indexOf("--target");
  const localOnly = process.argv.includes("local");

  if (targetIndex !== -1) {
    const bunTarget = process.argv[targetIndex + 1];
    if (!bunTarget) {
      console.error("Missing value for --target");
      process.exit(1);
    }
    const target = getTargetByBunTarget(bunTarget);
    if (!target) {
      console.error(`Unknown target: ${bunTarget}`);
      console.error(`Valid targets: ${TARGETS.map((t) => t.bunTarget).join(", ")}`);
      process.exit(1);
    }
    await buildBinary(target);
  } else if (localOnly) {
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
