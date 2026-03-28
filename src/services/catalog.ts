import { readFile, readdir, access } from "fs/promises";
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listCategories(): Promise<CatalogCategory[]> {
  const path = join(catalogDir(), "categories.yaml");
  if (!(await fileExists(path))) return [];
  const content = await readFile(path, "utf-8");
  const data = safeYamlLoad(content) as CatalogCategory[];
  return data ?? [];
}

export async function listAgents(category?: string): Promise<CatalogAgent[]> {
  const agentsDir = join(catalogDir(), "agents");
  if (!(await fileExists(agentsDir))) return [];

  const result: CatalogAgent[] = [];
  const entries = await readdir(agentsDir, { withFileTypes: true });
  const categories = entries.filter((d) => d.isDirectory());

  for (const cat of categories) {
    if (category && cat.name !== category) continue;
    const catDir = join(agentsDir, cat.name);
    const allFiles = await readdir(catDir);
    const files = allFiles.filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const content = await readFile(join(catDir, file), "utf-8");
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

export async function getAgent(name: string): Promise<CatalogAgent | null> {
  const allAgents = await listAgents();
  return allAgents.find((a) => a.name === name) ?? null;
}

export async function searchAgents(query: string): Promise<CatalogAgent[]> {
  const q = query.toLowerCase();
  return (await listAgents()).filter(
    (a) =>
      a.displayName.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
