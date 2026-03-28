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
    `messages_route_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  process.env.SHIRE_PROJECTS_DIR = testDir;

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

  const createRes = await request("POST", "/api/projects", { name: "test-project" });
  const projectData = (await createRes.json()) as Record<string, string>;
  projectId = projectData.id;

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

describe("GET /api/projects/:id/activity", () => {
  it("transforms inter_agent messages to flat shape", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "inter_agent",
      content: { text: "Hello from Alice", fromAgent: "Alice", toAgent: "Bob" },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { messages: Record<string, unknown>[]; hasMore: boolean };
    expect(data.messages).toHaveLength(1);

    const msg = data.messages[0];
    expect(msg.text).toBe("Hello from Alice");
    expect(msg.fromAgent).toBe("Alice");
    expect(msg.toAgent).toBe("Bob");
    expect(msg.role).toBe("inter_agent");
    expect(msg.ts).toBeDefined();
    expect(msg.id).toBeDefined();
    // Raw DB fields should not leak through
    expect(msg.content).toBeUndefined();
    expect(msg.createdAt).toBeUndefined();
  });

  it("supports legacy snake_case field names for backwards compatibility", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "inter_agent",
      content: { text: "Legacy msg", from_agent: "Alice", to_agent: "Bob" },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    const data = (await res.json()) as { messages: Record<string, unknown>[] };
    const msg = data.messages[0];
    expect(msg.fromAgent).toBe("Alice");
    expect(msg.toAgent).toBe("Bob");
  });

  it("includes trigger and taskLabel for scheduled task messages", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "system",
      content: {
        text: "Scheduled run",
        trigger: "scheduled_task",
        task_label: "daily-check",
        from_agent: "",
        to_agent: "test-agent",
      },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    const data = (await res.json()) as { messages: Record<string, unknown>[] };
    const msg = data.messages[0];
    expect(msg.trigger).toBe("scheduled_task");
    expect(msg.taskLabel).toBe("daily-check");
  });

  it("includes role for system messages", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "system",
      content: { text: "Session cleared" },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    const data = (await res.json()) as { messages: Record<string, unknown>[] };
    const msg = data.messages[0];
    expect(msg.role).toBe("system");
    expect(msg.fromAgent).toBe("");
    expect(msg.toAgent).toBe("");
  });

  it("omits trigger and taskLabel when not present", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "inter_agent",
      content: { text: "plain msg", fromAgent: "A", toAgent: "B" },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    const data = (await res.json()) as { messages: Record<string, unknown>[] };
    const msg = data.messages[0];
    expect(msg.trigger).toBeUndefined();
    expect(msg.taskLabel).toBeUndefined();
  });

  it("supports pagination with transformed data", async () => {
    for (let i = 1; i <= 3; i++) {
      agentsService.createMessage({
        projectId,
        agentId,
        role: "inter_agent",
        content: { text: `msg-${i}`, fromAgent: "A", toAgent: "B" },
      });
    }

    const res1 = await request("GET", `/api/projects/${projectId}/activity?limit=2`);
    const page1 = (await res1.json()) as {
      messages: { id: number; text: string }[];
      hasMore: boolean;
    };
    expect(page1.messages).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    // Messages are newest-first
    expect(page1.messages[0].text).toBe("msg-3");

    const oldestId = page1.messages[page1.messages.length - 1].id;
    const res2 = await request(
      "GET",
      `/api/projects/${projectId}/activity?before=${oldestId}&limit=2`,
    );
    const page2 = (await res2.json()) as {
      messages: { id: number; text: string }[];
      hasMore: boolean;
    };
    expect(page2.messages).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.messages[0].text).toBe("msg-1");
  });

  it("defaults text to empty string when content.text is missing", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "inter_agent",
      content: { fromAgent: "A", toAgent: "B" },
    });

    const res = await request("GET", `/api/projects/${projectId}/activity`);
    const data = (await res.json()) as { messages: { text: string }[] };
    expect(data.messages[0].text).toBe("");
  });
});
