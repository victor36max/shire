import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { createTestDb } from "../test/setup";
import * as projects from "../services/projects";
import * as agentsService from "../services/agents";
import * as alertChannelsService from "../services/alert-channels";
import { buildInternalPrompt } from "./system-prompt";

let testDir: string;
let projectId: string;
let agentId: string;

beforeEach(() => {
  createTestDb();
  testDir = join(tmpdir(), `sp_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;
  const project = projects.createProject(`test-project-${Date.now()}`);
  projectId = project.id;
  const agent = agentsService.createAgent(projectId, { name: "test-agent" });
  agentId = agent.id;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("buildInternalPrompt", () => {
  it("includes the agent name", () => {
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    expect(prompt).toContain("You are **my-agent**");
  });

  it("includes all core sections", () => {
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    expect(prompt).toContain("## First Responder Rule");
    expect(prompt).toContain("## Discovering Peers");
    expect(prompt).toContain("## Sending Messages");
    expect(prompt).toContain("## Receiving Messages");
    expect(prompt).toContain("## Attachments");
    expect(prompt).toContain("## Shared Drive");
    expect(prompt).toContain("## Project Document");
    expect(prompt).toContain("## Guidelines");
    expect(prompt).toContain("## File Access Boundary — MANDATORY");
  });

  it("includes workspace paths", () => {
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    expect(prompt).toContain(join(testDir, projectId, "peers.yaml"));
    expect(prompt).toContain(join(testDir, projectId, "agents", agentId));
    expect(prompt).toContain(join(testDir, projectId, "shared"));
    expect(prompt).toContain(join(testDir, projectId, "PROJECT.md"));
  });

  it("includes file access boundary with write-allowed and read-only paths", () => {
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    const projectRoot = join(testDir, projectId);
    const agentPath = join(testDir, projectId, "agents", agentId);
    const sharedPath = join(testDir, projectId, "shared");
    const projectDoc = join(testDir, projectId, "PROJECT.md");

    expect(prompt).toContain(`Your project root is \`${projectRoot}\``);
    expect(prompt).toContain("MUST NOT create, modify, move, copy, or delete");
    expect(prompt).toContain(`Your own directory: \`${agentPath}\``);
    expect(prompt).toContain(`The shared drive: \`${sharedPath}\``);
    expect(prompt).toContain(`Project document: \`${projectDoc}\``);
    expect(prompt).toContain(`${projectRoot}/agents/`);
    expect(prompt).toContain("Writing to another agent's directory");
    expect(prompt).toContain("Agent-specific state");
    expect(prompt).toContain("MUST be stored within your own directory");
  });

  it("excludes alert section when no alert channel is configured", () => {
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    expect(prompt).not.toContain("## Sending Alerts / Notifications");
    expect(prompt).not.toContain("system_alert");
  });

  it("includes alert section when alert channel is configured", () => {
    alertChannelsService.upsertAlertChannel(projectId, {
      config: { type: "discord", webhookUrl: "https://example.com/hook" },
      enabled: true,
    });
    const prompt = buildInternalPrompt({ agentName: "my-agent", projectId, agentId });
    expect(prompt).toContain("## Sending Alerts / Notifications");
    expect(prompt).toContain("system_alert");
    expect(prompt).toContain("severity: info");
    expect(prompt).toContain(
      join(testDir, projectId, "agents", agentId, "outbox/<alert-name>.yaml"),
    );
  });
});
