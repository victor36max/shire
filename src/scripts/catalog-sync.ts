#!/usr/bin/env bun
/**
 * Syncs agent catalog from an external GitHub repo.
 *
 * Usage:
 *   bun run src/scripts/catalog-sync.ts [--repo URL] [--clear]
 */
import { mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { safeYamlLoad } from "../utils/yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = "https://github.com/msitarzewski/agency-agents";
const SKIP_DIRS = new Set([".github", "integrations", "examples", ".git"]);
const CATALOG_DIR = join(__dirname, "..", "..", "catalog");

function parseArgs(): { repo: string; clear: boolean } {
  const args = process.argv.slice(2);
  let repo = DEFAULT_REPO;
  let clear = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo" && args[i + 1]) {
      repo = args[++i];
    } else if (args[i] === "--clear") {
      clear = true;
    }
  }

  return { repo, clear };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart();
  const parts = trimmed.split("---");
  if (parts.length >= 3 && parts[0] === "") {
    try {
      const frontmatter = safeYamlLoad(parts[1]) as Record<string, unknown>;
      const body = parts.slice(2).join("---").trim();
      return { frontmatter: frontmatter ?? {}, body };
    } catch {
      return { frontmatter: {}, body: trimmed };
    }
  }
  return { frontmatter: {}, body: trimmed };
}

function buildAgentYaml(
  frontmatter: Record<string, unknown>,
  body: string,
  category: string,
): Record<string, unknown> {
  const displayName = String(frontmatter.name ?? "");
  return {
    name: slugify(displayName),
    display_name: displayName,
    description: String(frontmatter.description ?? ""),
    category,
    emoji: String(frontmatter.emoji ?? ""),
    tags: [],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
    system_prompt: body,
  };
}

function encodeAgentYaml(map: Record<string, unknown>): string {
  const q = (s: unknown) => {
    const str = String(s ?? "");
    return str ? `"${str.replace(/"/g, '\\"')}"` : '""';
  };

  const lines = [
    `name: ${map.name}`,
    `display_name: ${q(map.display_name)}`,
    `description: ${q(map.description)}`,
    `category: ${map.category}`,
    `emoji: ${q(map.emoji)}`,
    `tags: []`,
    `harness: ${map.harness}`,
    `model: ${map.model}`,
    `system_prompt: |`,
    ...String(map.system_prompt ?? "")
      .split("\n")
      .map((line) => `  ${line}`),
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  const { repo, clear } = parseArgs();

  if (clear) {
    console.log("Clearing existing catalog...");
    rmSync(CATALOG_DIR, { recursive: true, force: true });
  }

  const tmpDir = join(tmpdir(), `catalog_sync_${Date.now()}`);

  try {
    console.log(`Cloning ${repo}...`);
    const result = Bun.spawnSync(["git", "clone", "--depth", "1", repo, tmpDir]);
    if (result.exitCode !== 0) {
      console.error(`Failed to clone repo: ${new TextDecoder().decode(result.stderr)}`);
      process.exit(1);
    }

    // Find category dirs (dirs containing .md files, excluding skip list)
    const entries = readdirSync(tmpDir);
    const categories = entries.filter((entry) => {
      if (SKIP_DIRS.has(entry)) return false;
      const path = join(tmpDir, entry);
      if (!statSync(path).isDirectory()) return false;
      return readdirSync(path).some((f) => f.endsWith(".md"));
    });

    let agentsCount = 0;

    for (const category of categories) {
      const categoryPath = join(tmpDir, category);
      const outDir = join(CATALOG_DIR, "agents", category);
      mkdirSync(outDir, { recursive: true });

      const mdFiles = readdirSync(categoryPath).filter(
        (f) => f.endsWith(".md") && f !== "README.md",
      );

      for (const file of mdFiles) {
        const content = readFileSync(join(categoryPath, file), "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        if (frontmatter.name) {
          const agentYaml = buildAgentYaml(frontmatter, body, category);
          const yamlContent = encodeAgentYaml(agentYaml);
          writeFileSync(join(outDir, `${agentYaml.name}.yaml`), yamlContent);
          agentsCount++;
        }
      }
    }

    // Write categories.yaml
    mkdirSync(CATALOG_DIR, { recursive: true });
    const categoryMaps = categories.map((cat) => ({
      id: cat,
      name: cat
        .replace(/-/g, " ")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: `${cat.charAt(0).toUpperCase() + cat.slice(1)} agents`,
    }));

    const categoriesYaml =
      categoryMaps
        .map((c) => `- id: ${c.id}\n  name: "${c.name}"\n  description: "${c.description}"`)
        .join("\n") + "\n";

    writeFileSync(join(CATALOG_DIR, "categories.yaml"), categoriesYaml);

    console.log(`Synced ${agentsCount} agents across ${categories.length} categories`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
