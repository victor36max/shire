import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import * as agentsService from "../services/agents";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let app: ReturnType<typeof createApp>;
let testDir: string;
let projectId: string;
let agentId: string;

beforeEach(async () => {
  createTestDb();
  testDir = join(
    tmpdir(),
    `agents_route_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  process.env.SHIRE_PROJECTS_DIR = testDir;

  // Mock the harness so agents don't actually start LLM sessions
  mock.module("../runtime/harness", () => ({
    createHarness: () => ({
      start: async () => {},
      sendMessage: async () => {},
      interrupt: async () => {},
      clearSession: async () => {},
      stop: async () => {},
      onEvent: () => {},
      isProcessing: () => false,
      getSessionId: () => null,
    }),
  }));

  const projectManager = new ProjectManager();
  const scheduler = new Scheduler(projectManager);
  app = createApp({ projectManager, scheduler });

  // Create a project
  const createRes = await request("POST", "/api/projects", { name: "test-project" });
  const projectData = (await createRes.json()) as Record<string, string>;
  projectId = projectData.id;

  // Create an agent
  const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
    name: "test-agent",
    description: "Test",
  });
  const agentData = (await agentRes.json()) as Record<string, string>;
  agentId = agentData.id;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("POST /api/projects/:id/agents/:aid/mark-read", () => {
  it("marks messages as read and reduces unread count", async () => {
    // Create some agent messages to generate unread count
    agentsService.createMessage({
      projectId,
      agentId,
      role: "agent",
      content: { text: "hello" },
    });
    const m2 = agentsService.createMessage({
      projectId,
      agentId,
      role: "agent",
      content: { text: "world" },
    });

    // Verify there are unread messages
    const listRes = await request("GET", `/api/projects/${projectId}/agents`);
    const agents = (await listRes.json()) as Array<Record<string, unknown>>;
    const agent = agents.find((a) => a.id === agentId);
    expect(agent?.unreadCount).toBeGreaterThan(0);

    // Mark read up to the latest message
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/mark-read`, {
      messageId: m2.id,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);

    // Verify unread count is now 0
    const listRes2 = await request("GET", `/api/projects/${projectId}/agents`);
    const agents2 = (await listRes2.json()) as Array<Record<string, unknown>>;
    const agent2 = agents2.find((a) => a.id === agentId);
    expect(agent2?.unreadCount).toBe(0);
  });

  it("partially marks read, leaving newer messages unread", async () => {
    const m1 = agentsService.createMessage({
      projectId,
      agentId,
      role: "agent",
      content: { text: "first" },
    });
    agentsService.createMessage({
      projectId,
      agentId,
      role: "agent",
      content: { text: "second" },
    });

    // Mark only up to the first message
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/mark-read`, {
      messageId: m1.id,
    });
    expect(res.status).toBe(200);

    // Second message should still be unread
    const listRes = await request("GET", `/api/projects/${projectId}/agents`);
    const agents = (await listRes.json()) as Array<Record<string, unknown>>;
    const agent = agents.find((a) => a.id === agentId);
    expect(agent?.unreadCount).toBe(1);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/nonexistent/mark-read`, {
      messageId: 1,
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", `/api/projects/nonexistent/agents/${agentId}/mark-read`, {
      messageId: 1,
    });
    expect(res.status).toBe(404);
  });
});
