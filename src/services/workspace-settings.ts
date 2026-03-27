import { readFileSync, writeFileSync, readdirSync, unlinkSync, chmodSync } from "fs";
import { execSync } from "child_process";
import * as workspace from "./workspace";

export function readEnv(projectId: string): string {
  try {
    return readFileSync(workspace.envPath(projectId), "utf-8");
  } catch {
    return "";
  }
}

export function writeEnv(projectId: string, content: string): void {
  writeFileSync(workspace.envPath(projectId), content, "utf-8");
}

export function listScripts(projectId: string): string[] {
  try {
    return readdirSync(workspace.projectScriptsDir(projectId)).filter((f) => f.endsWith(".sh"));
  } catch {
    return [];
  }
}

export function readAllScripts(projectId: string): Array<{ name: string; content: string }> {
  return listScripts(projectId).map((name) => ({
    name,
    content: readScript(projectId, name),
  }));
}

export function readScript(projectId: string, name: string): string {
  try {
    return readFileSync(workspace.scriptPath(projectId, name), "utf-8");
  } catch {
    return "";
  }
}

export function writeScript(projectId: string, name: string, content: string): void {
  const path = workspace.scriptPath(projectId, name);
  writeFileSync(path, content, "utf-8");
  chmodSync(path, 0o755);
}

export function deleteScript(projectId: string, name: string): void {
  try {
    unlinkSync(workspace.scriptPath(projectId, name));
  } catch {
    // idempotent
  }
}

export function runScript(
  projectId: string,
  name: string,
): { ok: true; output: string } | { ok: false; error: string } {
  const envContent = readEnv(projectId);
  const scriptContent = readScript(projectId, name);
  if (!scriptContent) {
    return { ok: false, error: "Script not found" };
  }

  const envSetup = envContent
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => `export ${line}`)
    .join("\n");

  const fullScript = `${envSetup}\n${scriptContent}`;

  try {
    const output = execSync(fullScript, {
      cwd: workspace.root(projectId),
      timeout: 120_000,
      encoding: "utf-8",
      shell: "/bin/bash",
    });
    return { ok: true, output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error running script";
    return { ok: false, error: message };
  }
}

export function readProjectDoc(projectId: string): string {
  try {
    return readFileSync(workspace.projectDocPath(projectId), "utf-8");
  } catch {
    return "";
  }
}

export function writeProjectDoc(projectId: string, content: string): void {
  writeFileSync(workspace.projectDocPath(projectId), content, "utf-8");
}
