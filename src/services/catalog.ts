import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { safeYamlLoad } from "../utils/yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CatalogAgent {
  name: string;
  displayName: string;
  description: string;
  category: string;
  emoji?: string;
  tags: string[];
  harness: string;
  model?: string;
  systemPrompt?: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
}

function catalogDir(): string {
  return join(__dirname, "..", "..", "catalog");
}

export function listCategories(): CatalogCategory[] {
  const path = join(catalogDir(), "categories.yaml");
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  const data = safeYamlLoad(content) as CatalogCategory[];
  return data ?? [];
}

export function listAgents(category?: string): CatalogAgent[] {
  const agentsDir = join(catalogDir(), "agents");
  if (!existsSync(agentsDir)) return [];

  const result: CatalogAgent[] = [];
  const categories = readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const cat of categories) {
    if (category && cat.name !== category) continue;
    const catDir = join(agentsDir, cat.name);
    const files = readdirSync(catDir).filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const content = readFileSync(join(catDir, file), "utf-8");
      const data = safeYamlLoad(content) as Record<string, unknown>;
      if (!data) continue;

      result.push({
        name: String(data.name ?? basename(file, ".yaml")),
        displayName: String(data.display_name ?? data.name ?? ""),
        description: String(data.description ?? ""),
        category: cat.name,
        emoji: data.emoji ? String(data.emoji) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        harness: String(data.harness ?? "claude_code"),
        model: data.model ? String(data.model) : undefined,
        systemPrompt: data.system_prompt ? String(data.system_prompt) : undefined,
      });
    }
  }

  return result;
}

export function getAgent(name: string): CatalogAgent | null {
  const allAgents = listAgents();
  return allAgents.find((a) => a.name === name) ?? null;
}

export function searchAgents(query: string): CatalogAgent[] {
  const q = query.toLowerCase();
  return listAgents().filter(
    (a) =>
      a.displayName.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
