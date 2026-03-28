import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  createTestDb();
  const projectManager = new ProjectManager();
  const scheduler = new Scheduler(projectManager);
  app = createApp({ projectManager, scheduler });
});

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return app.request(path, opts);
}

describe("GET /api/projects", () => {
  it("returns empty list initially", async () => {
    const res = await request("GET", "/api/projects");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/projects", () => {
  it("creates a project", async () => {
    const res = await request("POST", "/api/projects", { name: "my-project" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBe("my-project");
    expect(data.id).toBeTruthy();
  });

  it("rejects duplicate names", async () => {
    await request("POST", "/api/projects", { name: "dup" });
    const res = await request("POST", "/api/projects", { name: "dup" });
    expect(res.status).toBe(422);
  });

  it("lists created project with running status", async () => {
    await request("POST", "/api/projects", { name: "listed" });
    const res = await request("GET", "/api/projects");
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("listed");
    expect(data[0].status).toBe("running");
  });
});

describe("PATCH /api/projects/:id", () => {
  it("renames a project", async () => {
    const createRes = await request("POST", "/api/projects", { name: "old-name" });
    const { id } = (await createRes.json()) as Record<string, string>;

    const res = await request("PATCH", `/api/projects/${id}`, { name: "new-name" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBe("new-name");
  });
});

describe("DELETE /api/projects/:id", () => {
  it("deletes a project", async () => {
    const createRes = await request("POST", "/api/projects", { name: "delete-me" });
    const { id } = (await createRes.json()) as Record<string, string>;

    const res = await request("DELETE", `/api/projects/${id}`);
    expect(res.status).toBe(200);

    const listRes = await request("GET", "/api/projects");
    const data = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(data.length).toBe(0);
  });
});

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });
});
