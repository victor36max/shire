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

  it("returns flat objects with agentName", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "list-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "my-task",
      message: "hello",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });

    const res = await request("GET", `/api/projects/${projectId}/schedules`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>[];
    expect(data).toHaveLength(1);
    expect(data[0].label).toBe("my-task");
    expect(data[0].agentName).toBe("list-agent");
    expect(data[0].id).toBeDefined();
    // Should be flat — no nested scheduled_tasks key
    expect(data[0]).not.toHaveProperty("scheduled_tasks");
  });
});

describe("POST /api/projects/:id/schedules/:sid/toggle", () => {
  it("toggles enabled using id from the flat list response", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "toggle-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "toggle-task",
      message: "hi",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });

    const listRes = await request("GET", `/api/projects/${projectId}/schedules`);
    const tasks = (await listRes.json()) as { id: string; enabled: boolean }[];
    expect(tasks[0].enabled).toBe(true);

    const toggleRes = await request(
      "POST",
      `/api/projects/${projectId}/schedules/${tasks[0].id}/toggle`,
      { enabled: false },
    );
    expect(toggleRes.status).toBe(200);
    const toggled = (await toggleRes.json()) as { enabled: boolean };
    expect(toggled.enabled).toBe(false);
  });

  it("returns 404 for nonexistent schedule", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules/nonexistent/toggle`, {
      enabled: false,
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:id/schedules/:sid", () => {
  it("updates label of an existing schedule", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "patch-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "original-label",
      message: "hi",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });

    const listRes = await request("GET", `/api/projects/${projectId}/schedules`);
    const tasks = (await listRes.json()) as Array<Record<string, string>>;
    const taskId = tasks[0].id;

    const res = await request("PATCH", `/api/projects/${projectId}/schedules/${taskId}`, {
      label: "updated-label",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.label).toBe("updated-label");
  });

  it("returns 404 for nonexistent schedule", async () => {
    const res = await request("PATCH", `/api/projects/${projectId}/schedules/nonexistent`, {
      label: "nope",
    });
    expect(res.status).toBe(404);
  });

  it("rejects invalid cron in update", async () => {
    const res = await request("PATCH", `/api/projects/${projectId}/schedules/any-id`, {
      cronExpression: "bad",
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/projects/:id/schedules/:sid", () => {
  it("deletes an existing schedule", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "del-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "to-delete",
      message: "bye",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });

    const listRes = await request("GET", `/api/projects/${projectId}/schedules`);
    const tasks = (await listRes.json()) as Array<Record<string, string>>;
    const taskId = tasks[0].id;

    const res = await request("DELETE", `/api/projects/${projectId}/schedules/${taskId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);

    // Verify it's gone
    const listRes2 = await request("GET", `/api/projects/${projectId}/schedules`);
    const tasks2 = (await listRes2.json()) as Array<Record<string, unknown>>;
    expect(tasks2.find((t) => t.id === taskId)).toBeUndefined();
  });
});

describe("POST /api/projects/:id/schedules/:sid/run", () => {
  it("manually runs a schedule", async () => {
    const agentRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "run-agent",
    });
    const agent = (await agentRes.json()) as Record<string, string>;

    await request("POST", `/api/projects/${projectId}/schedules`, {
      agentId: agent.id,
      label: "manual-run",
      message: "do it now",
      scheduleType: "recurring",
      cronExpression: "0 9 * * *",
    });

    const listRes = await request("GET", `/api/projects/${projectId}/schedules`);
    const tasks = (await listRes.json()) as Array<Record<string, string>>;
    const taskId = tasks[0].id;

    const res = await request("POST", `/api/projects/${projectId}/schedules/${taskId}/run`);
    // Agent might return 422 because mock harness can't actually send, or 200 if sendMessage queues
    expect([200, 422]).toContain(res.status);
  });

  it("returns 404 for nonexistent schedule", async () => {
    const res = await request("POST", `/api/projects/${projectId}/schedules/nonexistent/run`);
    expect(res.status).toBe(404);
  });
});
