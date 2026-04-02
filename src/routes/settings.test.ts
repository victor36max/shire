import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import * as projectsService from "../services/projects";
import * as workspace from "../services/workspace";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let app: ReturnType<typeof createApp>;
let tmpDir: string;

beforeEach(() => {
  createTestDb();
  tmpDir = join(tmpdir(), `settings_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.SHIRE_PROJECTS_DIR = tmpDir;
  const projectManager = new ProjectManager();
  const scheduler = new Scheduler(projectManager);
  app = createApp({ projectManager, scheduler });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SHIRE_PROJECTS_DIR;
});

function createProjectWithDir(name: string) {
  const proj = projectsService.createProject(name);
  mkdirSync(workspace.root(proj.id), { recursive: true });
  return proj;
}

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("GET /api/projects/:id/settings/project-doc", () => {
  it("returns empty string when PROJECT.md does not exist", async () => {
    const proj = createProjectWithDir("test-proj");
    const res = await request("GET", `/api/projects/${proj.id}/settings/project-doc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("");
  });

  it("returns content when PROJECT.md exists", async () => {
    const proj = createProjectWithDir("test-proj");
    // Write a PROJECT.md
    await request("PUT", `/api/projects/${proj.id}/settings/project-doc`, {
      content: "# Hello World",
    });
    const res = await request("GET", `/api/projects/${proj.id}/settings/project-doc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("# Hello World");
  });

  it("resolves project by name", async () => {
    const proj = createProjectWithDir("by-name");
    await request("PUT", `/api/projects/${proj.id}/settings/project-doc`, {
      content: "resolved",
    });
    const res = await request("GET", "/api/projects/by-name/settings/project-doc");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("resolved");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request("GET", "/api/projects/nonexistent/settings/project-doc");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/projects/:id/settings/project-doc", () => {
  it("writes content successfully", async () => {
    const proj = createProjectWithDir("write-test");
    const res = await request("PUT", `/api/projects/${proj.id}/settings/project-doc`, {
      content: "new content",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request("PUT", "/api/projects/nonexistent/settings/project-doc", {
      content: "fail",
    });
    expect(res.status).toBe(404);
  });

  it("rejects missing content field", async () => {
    const proj = createProjectWithDir("no-content");
    const res = await request("PUT", `/api/projects/${proj.id}/settings/project-doc`, {});
    expect(res.status).toBe(400);
  });
});
