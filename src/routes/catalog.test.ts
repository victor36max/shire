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
  it("returns a list of categories", async () => {
    const res = await request("GET", "/api/catalog/categories");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    const first = data[0];
    expect(first.id).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.description).toBeDefined();
  });

  it("includes known categories", async () => {
    const res = await request("GET", "/api/catalog/categories");
    const data = (await res.json()) as Array<{ id: string; name: string; description: string }>;
    const ids = data.map((c) => c.id);
    expect(ids).toContain("engineering");
    expect(ids).toContain("design");
  });
});

describe("GET /api/catalog/agents", () => {
  it("returns all agents", async () => {
    const res = await request("GET", "/api/catalog/agents");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("returns agents with expected shape", async () => {
    const res = await request("GET", "/api/catalog/agents");
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const agent = data[0];
    expect(agent.name).toBeDefined();
    expect(typeof agent.name).toBe("string");
    expect(agent.displayName).toBeDefined();
    expect(agent.description).toBeDefined();
    expect(agent.category).toBeDefined();
    expect(agent.harness).toBeDefined();
    expect(Array.isArray(agent.tags)).toBe(true);
  });

  it("filters by category", async () => {
    const res = await request("GET", "/api/catalog/agents?category=engineering");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ category: string }>;
    expect(data.length).toBeGreaterThan(0);
    for (const agent of data) {
      expect(agent.category).toBe("engineering");
    }
  });

  it("returns empty array for unknown category", async () => {
    const res = await request("GET", "/api/catalog/agents?category=nonexistent");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(data).toEqual([]);
  });
});

describe("GET /api/catalog/agents/:name", () => {
  it("returns a specific agent by name", async () => {
    const res = await request("GET", "/api/catalog/agents/ai-engineer");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBe("ai-engineer");
    expect(data.displayName).toBe("AI Engineer");
    expect(data.category).toBe("engineering");
    expect(data.harness).toBe("claude_code");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await request("GET", "/api/catalog/agents/this-agent-does-not-exist");
    expect(res.status).toBe(404);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Agent not found");
  });
});
