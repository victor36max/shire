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

  const project = projects.createProject("alert-project");
  projectId = project.id;
  await projectManager.boot();
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("GET /api/projects/:id/alert-channel", () => {
  it("returns 404 when no channel configured", async () => {
    const res = await request("GET", `/api/projects/${projectId}/alert-channel`);
    expect(res.status).toBe(404);
  });

  it("returns the channel when configured", async () => {
    await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
    });
    const res = await request("GET", `/api/projects/${projectId}/alert-channel`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.config).toEqual({
      type: "discord",
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
    });
  });
});

describe("PUT /api/projects/:id/alert-channel", () => {
  it("creates a new channel", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "slack", webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect((data.config as Record<string, unknown>).type).toBe("slack");
  });

  it("updates an existing channel", async () => {
    await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "discord", webhookUrl: "https://old-url.com" },
    });
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "telegram", botToken: "123456:ABC", chatId: "-100123" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const config = data.config as Record<string, unknown>;
    expect(config.type).toBe("telegram");
    expect(config.chatId).toBe("-100123");
  });

  it("rejects missing config", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {});
    expect(res.status).toBe(400);
  });

  it("rejects invalid channel type", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "email", webhookUrl: "https://example.com" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects telegram without chatId", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "telegram", botToken: "123456:ABC" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects discord with non-URL webhookUrl", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "discord", webhookUrl: "not-a-url" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request("PUT", `/api/projects/nonexistent-id/alert-channel`, {
      config: { type: "discord", webhookUrl: "https://example.com/webhook" },
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:id/alert-channel", () => {
  it("removes the channel", async () => {
    await request("PUT", `/api/projects/${projectId}/alert-channel`, {
      config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
    });
    const res = await request("DELETE", `/api/projects/${projectId}/alert-channel`);
    expect(res.status).toBe(200);

    const getRes = await request("GET", `/api/projects/${projectId}/alert-channel`);
    expect(getRes.status).toBe(404);
  });
});

describe("POST /api/projects/:id/alert-channel/test", () => {
  it("returns 404 when no channel configured", async () => {
    const res = await request("POST", `/api/projects/${projectId}/alert-channel/test`);
    expect(res.status).toBe(404);
  });
});
