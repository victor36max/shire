import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import * as projects from "../services/projects";

// Mock the harness so agents don't start LLM sessions
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

let app: ReturnType<typeof createApp>;
let projectId: string;

beforeEach(async () => {
  createTestDb();
  const projectManager = new ProjectManager();
  const scheduler = new Scheduler(projectManager);
  app = createApp({ projectManager, scheduler });

  // Create a project and agent for schedule tests
  const project = projects.createProject("sched-project");
  projectId = project.id;
  await projectManager.boot();
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("POST /api/projects/:id/schedules", () => {
  it("creates a recurring schedule with valid cron", async () => {
    // First create an agent
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "cron-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "daily",
      message: "run check",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });
    expect(res.status).toBe(201);
  });

  it("rejects invalid cron expression", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: "some-id",
      label: "bad-cron",
      message: "test",
      scheduleType: "recurring",
      cronExpression: "not-a-cron",
    });
    expect(res.status).toBe(400);
  });

  it("rejects recurring schedule without cronExpression", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: "some-id",
      label: "missing-cron",
      message: "test",
      scheduleType: "recurring",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid scheduledAt date", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: "some-id",
      label: "bad-date",
      message: "test",
      scheduleType: "once",
      scheduledAt: "not-a-date",
    });
    expect(res.status).toBe(400);
  });

  it("accepts valid ISO date for one-time schedule", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "date-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "once",
      message: "do thing",
      scheduleType: "once",
      scheduledAt: futureDate,
    });
    expect(res.status).toBe(201);
  });

  it("rejects once schedule without scheduledAt", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: "some-id",
      label: "missing-date",
      message: "test",
      scheduleType: "once",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects/:id/schedules", () => {
  it("returns empty list initially", async () => {
    const res = await request("GET", `/api/projects/${projectId}/schedules`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});
