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

async function request(method: string, path: string) {
  return app.request(path, { method, headers: { "Content-Type": "application/json" } });
}

describe("GET /api/catalog/categories", () => {
  it("returns an array of categories", async () => {
    const res = await request("GET", "/api/catalog/categories");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ id: string; name: string }>;
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("GET /api/catalog/agents", () => {
  it("returns an array of agents", async () => {
    const res = await request("GET", "/api/catalog/agents");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ name: string }>;
    expect(Array.isArray(data)).toBe(true);
  });

  it("supports category filter", async () => {
    const res = await request("GET", "/api/catalog/agents?category=engineering");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ category: string }>;
    expect(Array.isArray(data)).toBe(true);
    for (const agent of data) {
      expect(agent.category).toBe("engineering");
    }
  });
});

describe("GET /api/catalog/agents/:name", () => {
  it("returns 404 for unknown agent", async () => {
    const res = await request("GET", "/api/catalog/agents/nonexistent-agent-xyz");
    expect(res.status).toBe(404);
  });

  it("returns agent details for a known agent", async () => {
    // First get a real agent name from the list
    const listRes = await request("GET", "/api/catalog/agents");
    const agents = (await listRes.json()) as Array<{ name: string }>;
    if (agents.length === 0) return; // Skip if no catalog agents

    const res = await request("GET", `/api/catalog/agents/${agents[0].name}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string; description: string };
    expect(data.name).toBe(agents[0].name);
  });
});
