import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb } from "../test/setup";
import { searchMessages, backfillFts } from "./fts";
import { getSqlite } from "./index";
import { projects, agents } from "./schema";
import * as agentsService from "../services/agents";

function seedProject(db: ReturnType<typeof createTestDb>) {
  const project = db.insert(projects).values({ id: "p1", name: "test-project" }).returning().get();
  const agent = db
    .insert(agents)
    .values({ id: "a1", projectId: "p1", name: "test-agent" })
    .returning()
    .get();
  return { project, agent };
}

describe("FTS message search", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("indexes user messages and returns search results", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "How do I deploy to production?" },
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "agent",
      content: { text: "You can deploy using the CI pipeline." },
    });

    const results = searchMessages("p1", "a1", "deploy");
    expect(results.length).toBe(2);
    expect(results[0].role).toBeDefined();
  });

  it("does not index tool_use messages", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "tool_use",
      content: {
        tool: "Bash",
        tool_use_id: "t1",
        input: {},
        output: "deploy output",
        is_error: false,
      },
    });

    const results = searchMessages("p1", "a1", "deploy");
    expect(results.length).toBe(0);
  });

  it("does not index system messages", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "system",
      content: { text: "System initialization complete" },
    });

    const results = searchMessages("p1", "a1", "initialization");
    expect(results.length).toBe(0);
  });

  it("filters results by projectId and agentId", () => {
    seedProject(db);
    db.insert(agents).values({ id: "a2", projectId: "p1", name: "other-agent" }).returning().get();

    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Deploy the API server" },
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a2",
      role: "user",
      content: { text: "Deploy the frontend" },
    });

    const results = searchMessages("p1", "a1", "deploy");
    expect(results.length).toBe(1);
    expect(JSON.parse(results[0].content).text).toBe("Deploy the API server");
  });

  it("respects limit parameter", () => {
    seedProject(db);
    for (let i = 0; i < 5; i++) {
      agentsService.createMessage({
        projectId: "p1",
        agentId: "a1",
        role: "user",
        content: { text: `Message about deployment number ${i}` },
      });
    }

    const results = searchMessages("p1", "a1", "deployment", 2);
    expect(results.length).toBe(2);
  });

  it("removes FTS entries when messages are deleted", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Secret deployment info" },
    });

    expect(searchMessages("p1", "a1", "secret").length).toBe(1);

    // Delete the agent (cascades to messages)
    agentsService.deleteAgent("a1");
    expect(searchMessages("p1", "a1", "secret").length).toBe(0);
  });

  it("indexes inter_agent messages", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "inter_agent",
      content: { text: "Can you check the deployment logs?", fromAgent: "a2", toAgent: "a1" },
    });

    const results = searchMessages("p1", "a1", "deployment");
    expect(results.length).toBe(1);
  });

  it("throws on malformed FTS query", () => {
    seedProject(db);
    expect(() => searchMessages("p1", "a1", '"unclosed')).toThrow("Invalid search query");
  });

  it("backfillFts indexes pre-existing messages", () => {
    seedProject(db);
    const sqlite = getSqlite();

    // Insert directly via raw SQL to bypass the trigger, simulating a pre-FTS message
    sqlite.exec(`
      INSERT INTO messages (project_id, agent_id, role, content, created_at)
      VALUES ('p1', 'a1', 'user', '{"text":"Old message about testing"}', '2026-01-01T00:00:00.000Z')
    `);
    // Delete the auto-indexed row (trigger fires on raw INSERT too), then re-insert without trigger
    // Actually the trigger fires on raw SQL too — so we need to delete from FTS first
    const inserted = sqlite.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get();
    sqlite.exec(`DELETE FROM messages_fts WHERE rowid = ${inserted!.id}`);

    // Verify not in FTS
    expect(searchMessages("p1", "a1", "testing").length).toBe(0);

    // Run backfill
    backfillFts(sqlite);

    expect(searchMessages("p1", "a1", "testing").length).toBe(1);
  });
});
