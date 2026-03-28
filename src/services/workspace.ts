import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { mkdirSync, rmSync } from "fs";

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

export function peersPath(projectId: string): string {
  return join(root(projectId), "peers.yaml");
}

export function projectDocPath(projectId: string): string {
  return join(root(projectId), "PROJECT.md");
}

export async function ensureProjectDirs(projectId: string): Promise<void> {
  await Promise.all([
    mkdir(root(projectId), { recursive: true }),
    mkdir(sharedDir(projectId), { recursive: true }),
  ]);
}

export async function ensureAgentDirs(projectId: string, agentId: string): Promise<void> {
  await Promise.all([
    mkdir(agentDir(projectId, agentId), { recursive: true }),
    mkdir(inboxDir(projectId, agentId), { recursive: true }),
    mkdir(outboxDir(projectId, agentId), { recursive: true }),
    mkdir(attachmentsDir(projectId, agentId), { recursive: true }),
    mkdir(join(attachmentsDir(projectId, agentId), "outbox"), { recursive: true }),
  ]);
}

/** Sync versions for use inside DB transactions */

export function ensureProjectDirsSync(projectId: string): void {
  mkdirSync(root(projectId), { recursive: true });
  mkdirSync(sharedDir(projectId), { recursive: true });
}

export function ensureAgentDirsSync(projectId: string, agentId: string): void {
  mkdirSync(agentDir(projectId, agentId), { recursive: true });
  mkdirSync(inboxDir(projectId, agentId), { recursive: true });
  mkdirSync(outboxDir(projectId, agentId), { recursive: true });
  mkdirSync(attachmentsDir(projectId, agentId), { recursive: true });
  mkdirSync(join(attachmentsDir(projectId, agentId), "outbox"), { recursive: true });
}

export function removeAgentDirSync(projectId: string, agentId: string): void {
  rmSync(agentDir(projectId, agentId), { recursive: true, force: true });
}

export function removeProjectDirSync(projectId: string): void {
  rmSync(root(projectId), { recursive: true, force: true });
}
