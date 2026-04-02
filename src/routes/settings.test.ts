import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let app: ReturnType<typeof createApp>;
let testDir: string;
let projectId: string;
let projectName: string;

beforeEach(async () => {
  createTestDb();
  testDir = join(
    tmpdir(),
    `settings_route_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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

  projectName = "settings-test-project";
  const project = projects.createProject(projectName);
  projectId = project.id;
  await workspace.ensureProjectDirs(projectId);
  await projectManager.boot();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("GET /api/projects/:id/settings/project-doc", () => {
  it("returns empty string when PROJECT.md does not exist", async () => {
    const res = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("");
  });

  it("returns content when PROJECT.md exists", async () => {
    await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "# My Project\nSome documentation here.",
    });

    const res = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("# My Project\nSome documentation here.");
  });

  it("resolves project by name", async () => {
    await request("PUT", `/api/projects/${projectName}/settings/project-doc`, {
      content: "resolved by name",
    });

    const res = await request("GET", `/api/projects/${projectName}/settings/project-doc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("resolved by name");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request("GET", `/api/projects/nonexistent-id/settings/project-doc`);
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Project not found");
  });
});

describe("PUT /api/projects/:id/settings/project-doc", () => {
  it("writes content successfully", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "Hello, world!",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);

    // Verify by reading back
    const getRes = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    const getData = (await getRes.json()) as { content: string };
    expect(getData.content).toBe("Hello, world!");
  });

  it("overwrites existing content", async () => {
    await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "original content",
    });
    await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "updated content",
    });

    const res = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("updated content");
  });

  it("writes empty string content", async () => {
    await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "some content",
    });
    const res = await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {
      content: "",
    });
    expect(res.status).toBe(200);

    const getRes = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    const data = (await getRes.json()) as { content: string };
    expect(data.content).toBe("");
  });

  it("rejects missing content field", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/settings/project-doc`, {});
    expect(res.status).toBe(400);
  });

  it("rejects missing body", async () => {
    const res = await request("PUT", `/api/projects/${projectId}/settings/project-doc`);
    expect(res.status).toBe(400);
  });

  it("resolves project by name", async () => {
    const res = await request("PUT", `/api/projects/${projectName}/settings/project-doc`, {
      content: "written by name",
    });
    expect(res.status).toBe(200);

    // Verify via project ID
    const getRes = await request("GET", `/api/projects/${projectId}/settings/project-doc`);
    const data = (await getRes.json()) as { content: string };
    expect(data.content).toBe("written by name");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request("PUT", `/api/projects/nonexistent-id/settings/project-doc`, {
      content: "test",
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Project not found");
  });
});
