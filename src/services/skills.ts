import { readdir, readFile, writeFile, mkdir, rm } from "fs/promises";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, basename } from "path";
import yaml from "js-yaml";
import { valid as isValidSlug } from "./slug";
import * as workspace from "./workspace";

export interface SkillReference {
  name: string;
  content: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  references?: SkillReference[];
}

// --- SKILL.md parsing ---

function parseSkillMd(raw: string): { name: string; description: string; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { name: "", description: "", content: raw.trim() };
  const meta = yaml.load(match[1]) as Record<string, string> | undefined;
  return {
    name: meta?.name ?? "",
    description: meta?.description ?? "",
    content: match[2].trim(),
  };
}

function composeSkillMd(skill: Skill): string {
  const front = yaml.dump({ name: skill.name, description: skill.description }).trimEnd();
  return `---\n${front}\n---\n\n${skill.content}\n`;
}

// --- Async operations ---

export async function ensureSkillsDir(
  projectId: string,
  agentId: string,
  harness?: string,
): Promise<void> {
  await mkdir(workspace.skillsDir(projectId, agentId, harness), { recursive: true });
}

export async function readSkills(
  projectId: string,
  agentId: string,
  harness?: string,
): Promise<Skill[]> {
  const dir = workspace.skillsDir(projectId, agentId, harness);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(dir, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillPath, "utf-8");
    } catch {
      continue;
    }
    const parsed = parseSkillMd(raw);

    // Read reference files (everything except SKILL.md)
    const references: SkillReference[] = [];
    try {
      const files = await readdir(join(dir, entry.name));
      for (const file of files) {
        if (file === "SKILL.md") continue;
        const refContent = await readFile(join(dir, entry.name, file), "utf-8");
        references.push({ name: file, content: refContent });
      }
    } catch {
      /* skip references on error */
    }

    skills.push({
      name: parsed.name || entry.name,
      description: parsed.description,
      content: parsed.content,
      ...(references.length > 0 ? { references } : {}),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeSkill(
  projectId: string,
  agentId: string,
  skill: Skill,
  harness?: string,
): Promise<void> {
  if (!isValidSlug(skill.name)) {
    throw new Error(`Invalid skill name: ${skill.name}`);
  }

  const dir = workspace.skillDir(projectId, agentId, skill.name, harness);
  await mkdir(dir, { recursive: true });

  // Write SKILL.md
  await writeFile(join(dir, "SKILL.md"), composeSkillMd(skill), "utf-8");

  // Reconcile reference files: remove stale, write current
  const existingFiles = new Set<string>();
  try {
    for (const f of await readdir(dir)) {
      if (f !== "SKILL.md") existingFiles.add(f);
    }
  } catch {
    /* ok */
  }

  const newRefNames = new Set<string>();
  for (const ref of skill.references ?? []) {
    if (!ref.name || ref.name !== basename(ref.name) || ref.name === "SKILL.md") {
      throw new Error(`Invalid reference name: ${ref.name}`);
    }
    newRefNames.add(ref.name);
    await writeFile(join(dir, ref.name), ref.content, "utf-8");
  }

  // Delete stale references
  for (const stale of existingFiles) {
    if (!newRefNames.has(stale)) {
      await rm(join(dir, stale), { force: true });
    }
  }
}

export async function writeSkills(
  projectId: string,
  agentId: string,
  skills: Skill[],
  harness?: string,
): Promise<void> {
  await ensureSkillsDir(projectId, agentId, harness);

  // Determine which skill dirs to remove
  const dir = workspace.skillsDir(projectId, agentId, harness);
  const existingDirs = new Set<string>();
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) existingDirs.add(e.name);
    }
  } catch {
    /* ok */
  }

  const newNames = new Set(skills.map((s) => s.name));

  // Delete removed skills
  for (const existing of existingDirs) {
    if (!newNames.has(existing)) {
      await rm(join(dir, existing), { recursive: true, force: true });
    }
  }

  // Write all skills
  for (const skill of skills) {
    await writeSkill(projectId, agentId, skill, harness);
  }
}

export async function deleteSkill(
  projectId: string,
  agentId: string,
  skillName: string,
  harness?: string,
): Promise<void> {
  if (!isValidSlug(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  const dir = workspace.skillDir(projectId, agentId, skillName, harness);
  await rm(dir, { recursive: true, force: true });
}

// --- Sync operations (for use inside DB transactions) ---

export function copySkillsSync(
  projectId: string,
  agentId: string,
  oldHarness: string | null,
  newHarness: string,
): void {
  const src = workspace.skillsDir(projectId, agentId, oldHarness ?? undefined);
  const dest = workspace.skillsDir(projectId, agentId, newHarness);

  if (!existsSync(src)) return;

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function removeSkillsDirSync(
  projectId: string,
  agentId: string,
  harness?: string | null,
): void {
  const dir = workspace.skillsDir(projectId, agentId, harness ?? undefined);
  rmSync(dir, { recursive: true, force: true });
}

// Exported for testing
export { parseSkillMd, composeSkillMd };
