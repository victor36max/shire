import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";

export function projectsDir(): string {
  return process.env.SHIRE_PROJECTS_DIR || join(homedir(), ".shire", "projects");
}

export function root(projectId: string): string {
  return join(projectsDir(), projectId);
}

export function agentsDir(projectId: string): string {
  return join(root(projectId), "agents");
}

export function agentDir(projectId: string, agentId: string): string {
  return join(agentsDir(projectId), agentId);
}

export function inboxDir(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "inbox");
}

export function outboxDir(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "outbox");
}

export function scriptsDir(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "scripts");
}

export function documentsDir(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "documents");
}

export function attachmentsDir(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "attachments");
}

export function attachmentDir(projectId: string, agentId: string, attachmentId: string): string {
  return join(attachmentsDir(projectId, agentId), attachmentId);
}

export function attachmentPath(
  projectId: string,
  agentId: string,
  attachmentId: string,
  filename: string,
): string {
  return join(attachmentDir(projectId, agentId, attachmentId), filename);
}

export function sharedDir(projectId: string): string {
  return join(root(projectId), "shared");
}

export function runnerDir(projectId: string): string {
  return join(root(projectId), ".runner");
}

export function peersPath(projectId: string): string {
  return join(root(projectId), "peers.yaml");
}

export function projectDocPath(projectId: string): string {
  return join(root(projectId), "PROJECT.md");
}

export function recipePath(projectId: string, agentId: string): string {
  return join(agentDir(projectId, agentId), "recipe.yaml");
}

export async function ensureProjectDirs(projectId: string): Promise<void> {
  await Promise.all([
    mkdir(root(projectId), { recursive: true }),
    mkdir(sharedDir(projectId), { recursive: true }),
    mkdir(runnerDir(projectId), { recursive: true }),
  ]);
}

export async function ensureAgentDirs(projectId: string, agentId: string): Promise<void> {
  await Promise.all([
    mkdir(agentDir(projectId, agentId), { recursive: true }),
    mkdir(inboxDir(projectId, agentId), { recursive: true }),
    mkdir(outboxDir(projectId, agentId), { recursive: true }),
    mkdir(scriptsDir(projectId, agentId), { recursive: true }),
    mkdir(documentsDir(projectId, agentId), { recursive: true }),
    mkdir(attachmentsDir(projectId, agentId), { recursive: true }),
    mkdir(join(attachmentsDir(projectId, agentId), "outbox"), { recursive: true }),
  ]);
}
