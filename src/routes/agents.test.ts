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

describe("POST /api/projects/:id/agents/:aid/message attachmentIds validation", () => {
  it("rejects non-array attachmentIds", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/message`, {
      text: "hello",
      attachmentIds: "not-an-array",
    });
    expect(res.status).toBe(400);
  });

  it("rejects attachmentIds with path traversal", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/message`, {
      text: "hello",
      attachmentIds: ["../../../etc"],
    });
    // Should be 400 (path traversal check) or 404 (not found)
    expect([400, 404]).toContain(res.status);
  });

  it("accepts well-formed attachmentIds", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/message`, {
      text: "hello",
      attachmentIds: ["some-id"],
    });
    // Will be 404 (attachment not found) since we didn't upload, but not 400 (validation pass)
    expect(res.status).not.toBe(400);
  });

  it("accepts message without attachmentIds", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/message`, {
      text: "hello",
    });
    // Not 400 — validation passes (422 expected since agent isn't active)
    expect(res.status).not.toBe(400);
  });
});

describe("POST /api/projects/:id/agents/:aid/clear-history", () => {
  it("clears all messages for the agent", async () => {
    agentsService.createMessage({
      projectId,
      agentId,
      role: "user",
      content: { text: "hello" },
    });
    agentsService.createMessage({
      projectId,
      agentId,
      role: "agent",
      content: { text: "hi there" },
    });

    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/clear-history`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);

    const { messages } = agentsService.listMessages(projectId, agentId);
    expect(messages.length).toBe(0);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request(
      "POST",
      `/api/projects/${projectId}/agents/nonexistent/clear-history`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", `/api/projects/nonexistent/agents/${agentId}/clear-history`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/agents", () => {
  it("lists agents for a project", async () => {
    const res = await request("GET", `/api/projects/${projectId}/agents`);
    expect(res.status).toBe(200);
    const agents = (await res.json()) as Array<Record<string, unknown>>;
    expect(agents.length).toBeGreaterThanOrEqual(1);
    const found = agents.find((a) => a.id === agentId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("test-agent");
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("GET", "/api/projects/nonexistent/agents");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/agents", () => {
  it("creates a new agent and returns its id", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "new-agent",
      description: "A new agent",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, string>;
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe("string");
  });

  it("returns 422 for duplicate agent name", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "test-agent",
    });
    expect(res.status).toBe(422);
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toContain("already exists");
  });

  it("returns 422 for invalid agent name", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "A",
    });
    expect(res.status).toBe(422);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", "/api/projects/nonexistent/agents", {
      name: "some-agent",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/agents/:aid", () => {
  it("returns agent detail", async () => {
    const res = await request("GET", `/api/projects/${projectId}/agents/${agentId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.id).toBe(agentId);
    expect(data.name).toBe("test-agent");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("GET", `/api/projects/${projectId}/agents/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("GET", `/api/projects/nonexistent/agents/${agentId}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:id/agents/:aid", () => {
  it("updates agent description", async () => {
    const res = await request("PATCH", `/api/projects/${projectId}/agents/${agentId}`, {
      description: "Updated description",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);
  });

  it("updates agent name", async () => {
    const res = await request("PATCH", `/api/projects/${projectId}/agents/${agentId}`, {
      name: "renamed-agent",
    });
    expect(res.status).toBe(200);

    // Verify the rename took effect
    const detailRes = await request("GET", `/api/projects/${projectId}/agents/${agentId}`);
    const detail = (await detailRes.json()) as Record<string, unknown>;
    expect(detail.name).toBe("renamed-agent");
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("PATCH", `/api/projects/nonexistent/agents/${agentId}`, {
      description: "nope",
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 for unknown agent", async () => {
    const res = await request("PATCH", `/api/projects/${projectId}/agents/nonexistent`, {
      description: "nope",
    });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/projects/:id/agents/:aid", () => {
  it("deletes an agent", async () => {
    // Create an agent to delete
    const createRes = await request("POST", `/api/projects/${projectId}/agents`, {
      name: "to-delete",
    });
    const created = (await createRes.json()) as Record<string, string>;

    const res = await request("DELETE", `/api/projects/${projectId}/agents/${created.id}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);

    // Verify it's gone
    const detailRes = await request("GET", `/api/projects/${projectId}/agents/${created.id}`);
    expect(detailRes.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("DELETE", `/api/projects/nonexistent/agents/${agentId}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/agents/:aid/restart", () => {
  it("restarts an existing agent", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/restart`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/nonexistent/restart`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", `/api/projects/nonexistent/agents/${agentId}/restart`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/agents/:aid/interrupt", () => {
  it("returns 200 when agent is active (mock harness)", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/interrupt`);
    // Mock harness starts successfully, so agent status is "active" and interrupt succeeds
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/nonexistent/interrupt`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", `/api/projects/nonexistent/agents/${agentId}/interrupt`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/agents/:aid/clear", () => {
  it("returns 200 when agent is active (mock harness)", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/${agentId}/clear`);
    // Mock harness starts successfully, so agent status is "active" and clearSession succeeds
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, boolean>;
    expect(data.ok).toBe(true);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("POST", `/api/projects/${projectId}/agents/nonexistent/clear`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await request("POST", `/api/projects/nonexistent/agents/${agentId}/clear`);
    expect(res.status).toBe(404);
  });
});
