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

async function buildFrontend(outDir: string): Promise<void> {
  console.log("Building frontend...");

  const tailwind = (await import("bun-plugin-tailwind")).default;

  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", "frontend", "main.tsx")],
    outdir: outDir,
    minify: true,
    splitting: true,
    target: "browser",
    publicPath: "/",
    plugins: [tailwind],
  });

  if (!result.success) {
    console.error("Frontend build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Copy index.html and update script/link refs to point to built assets
  const htmlSrc = join(ROOT, "src", "frontend", "index.html");
  const htmlContent = await Bun.file(htmlSrc).text();

  // Find the built JS and CSS output files
  const jsOutput = result.outputs.find((o) => o.path.endsWith(".js") && o.kind === "entry-point");
  const cssOutput = result.outputs.find((o) => o.path.endsWith(".css"));

  const jsName = jsOutput ? jsOutput.path.split("/").pop() : "main.js";
  const cssName = cssOutput ? cssOutput.path.split("/").pop() : "app.css";

  const updatedHtml = htmlContent
    .replace(/<link rel="stylesheet" href="[^"]*"/, `<link rel="stylesheet" href="/${cssName}"`)
    .replace(/<script type="module" src="[^"]*"/, `<script type="module" src="/${jsName}"`);

  await Bun.write(join(outDir, "index.html"), updatedHtml);

  // Copy font files
  const fontsDir = join(ROOT, "node_modules", "@fontsource-variable", "dm-sans", "files");
  const { existsSync, readdirSync } = await import("fs");
  if (existsSync(fontsDir)) {
    for (const file of readdirSync(fontsDir)) {
      if (file.endsWith(".woff2") || file.endsWith(".woff")) {
        cpSync(join(fontsDir, file), join(outDir, file));
      }
    }
  }

  console.log("Frontend build complete.");
}

async function buildBinary(target: Target, frontendDir: string): Promise<void> {
  const outDir = join(ROOT, "npm", target.npmDir);
  const outFile = join(outDir, target.binaryName);

  console.log(`Building ${target.bunTarget} → npm/${target.npmDir}/${target.binaryName}`);

  await $`bun build src/cli.ts --compile --target=${target.bunTarget} --outfile=${outFile} --define process.env.NODE_ENV='"production"'`.cwd(
    ROOT,
  );

  // Copy pre-built frontend alongside the binary
  const frontendDest = join(outDir, "frontend");
  mkdirSync(frontendDest, { recursive: true });
  cpSync(frontendDir, frontendDest, { recursive: true });

  // Copy migrations
  const drizzleSrc = join(ROOT, "drizzle");
  const drizzleDest = join(outDir, "drizzle");
  mkdirSync(drizzleDest, { recursive: true });
  cpSync(drizzleSrc, drizzleDest, { recursive: true });

  console.log(`  Done: ${target.npmDir}`);
}

async function main(): Promise<void> {
  const localOnly = process.argv.includes("local");

  // Pre-build frontend for production
  const frontendOut = join(ROOT, "dist", "frontend");
  mkdirSync(frontendOut, { recursive: true });
  await buildFrontend(frontendOut);

  if (localOnly) {
    const current = getCurrentTarget();
    if (!current) {
      console.error(`No target for current platform: ${process.platform}-${process.arch}`);
      process.exit(1);
    }
    await buildBinary(current, frontendOut);
  } else {
    for (const target of TARGETS) {
      await buildBinary(target, frontendOut);
    }
  }

  console.log("\nBuild complete!");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
