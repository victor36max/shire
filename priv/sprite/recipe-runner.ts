/**
 * recipe-runner.ts — Idempotent script runner for agent recipes.
 *
 * Reads /workspace/recipe.json (deployed by AgentManager), executes each
 * script step with marker-file idempotency. If a script's content hash
 * matches an existing marker, it's skipped. Otherwise it runs and a new
 * marker is written on success.
 *
 * Output: JSON lines to stdout for AgentManager to consume.
 * Exit 0 = all steps done/skipped, Exit 1 = a step failed.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

interface Script {
  name: string;
  run: string;
}

interface Recipe {
  scripts: Script[];
}

function emit(data: Record<string, unknown>) {
  console.log(JSON.stringify(data));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function getMarkerPath(name: string, hash: string): string {
  return join("/workspace/.recipe-state", `${name}.${hash}`);
}

function hasMarker(name: string, hash: string): boolean {
  return existsSync(getMarkerPath(name, hash));
}

function clearOldMarkers(name: string, currentHash: string): void {
  const dir = "/workspace/.recipe-state";
  if (!existsSync(dir)) return;

  for (const file of readdirSync(dir)) {
    if (file.startsWith(`${name}.`) && !file.endsWith(`.${currentHash}`)) {
      unlinkSync(join(dir, file));
    }
  }
}

function writeMarker(name: string, hash: string): void {
  writeFileSync(getMarkerPath(name, hash), new Date().toISOString());
}

async function runScript(script: Script): Promise<boolean> {
  const hash = hashContent(script.run);

  if (hasMarker(script.name, hash)) {
    emit({ type: "recipe_step", name: script.name, status: "skipped" });
    return true;
  }

  clearOldMarkers(script.name, hash);

  const proc = Bun.spawn(["bash", "-c", script.run], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/workspace",
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    writeMarker(script.name, hash);
    emit({ type: "recipe_step", name: script.name, status: "done" });
    return true;
  } else {
    emit({
      type: "recipe_step",
      name: script.name,
      status: "failed",
      exit_code: exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
    return false;
  }
}

async function main() {
  const recipePath = "/workspace/recipe.json";

  if (!existsSync(recipePath)) {
    emit({ type: "recipe_complete", status: "no_recipe" });
    process.exit(0);
  }

  const recipe: Recipe = JSON.parse(readFileSync(recipePath, "utf-8"));

  if (!recipe.scripts || recipe.scripts.length === 0) {
    emit({ type: "recipe_complete", status: "no_scripts" });
    process.exit(0);
  }

  for (const script of recipe.scripts) {
    const success = await runScript(script);
    if (!success) {
      emit({ type: "recipe_complete", status: "failed", failed_step: script.name });
      process.exit(1);
    }
  }

  emit({ type: "recipe_complete", status: "done", steps: recipe.scripts.length });
  process.exit(0);
}

main();
