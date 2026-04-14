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

    const results = searchMessages("p1", "a1", "deployment", { limit: 2 });
    expect(results.length).toBe(2);
  });

  it("filters results by date range", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Early deployment notes" },
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Mid deployment notes" },
      createdAt: "2026-04-05T00:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Late deployment notes" },
      createdAt: "2026-05-10T00:00:00.000Z",
    });

    const inRange = searchMessages("p1", "a1", "deployment", {
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    expect(inRange.length).toBe(1);
    expect(JSON.parse(inRange[0].content).text).toBe("Mid deployment notes");

    const fromApril = searchMessages("p1", "a1", "deployment", { startDate: "2026-04-01" });
    expect(fromApril.length).toBe(2);

    const untilApril = searchMessages("p1", "a1", "deployment", { endDate: "2026-04-30" });
    expect(untilApril.length).toBe(2);
  });

  it("extends date-only endDate to end-of-day", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Midday deployment notes" },
      createdAt: "2026-04-30T12:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Next-day deployment notes" },
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    // Date-only endDate should include messages later the same day.
    const results = searchMessages("p1", "a1", "deployment", { endDate: "2026-04-30" });
    expect(results.length).toBe(1);
    expect(JSON.parse(results[0].content).text).toBe("Midday deployment notes");
  });

  it("paginates via limit + offset", () => {
    seedProject(db);
    for (let i = 0; i < 5; i++) {
      agentsService.createMessage({
        projectId: "p1",
        agentId: "a1",
        role: "user",
        content: { text: `Message about deployment number ${i}` },
      });
    }

    const page1 = searchMessages("p1", "a1", "deployment", { limit: 2, offset: 0 });
    const page2 = searchMessages("p1", "a1", "deployment", { limit: 2, offset: 2 });
    const page3 = searchMessages("p1", "a1", "deployment", { limit: 2, offset: 4 });
    const beyond = searchMessages("p1", "a1", "deployment", { limit: 2, offset: 10 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page3.length).toBe(1);
    expect(beyond.length).toBe(0);

    const ids = new Set([...page1, ...page2, ...page3].map((r) => r.id));
    expect(ids.size).toBe(5);
  });

  it("supports date-only search with empty query", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Unrelated morning chat" },
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "agent",
      content: { text: "Different topic entirely" },
      createdAt: "2026-04-08T15:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "Message on another day" },
      createdAt: "2026-04-09T09:00:00.000Z",
    });

    const results = searchMessages("p1", "a1", "", {
      startDate: "2026-04-08",
      endDate: "2026-04-08",
    });
    expect(results.length).toBe(2);
    // Ordered by created_at DESC when no text filter is given.
    expect(JSON.parse(results[0].content).text).toBe("Different topic entirely");
    expect(JSON.parse(results[1].content).text).toBe("Unrelated morning chat");
  });

  it("date-only search excludes non-indexed roles", () => {
    seedProject(db);
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "user",
      content: { text: "User message" },
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "tool_use",
      content: {
        tool: "Bash",
        tool_use_id: "t1",
        input: {},
        output: "something",
        is_error: false,
      },
      createdAt: "2026-04-08T10:00:00.000Z",
    });
    agentsService.createMessage({
      projectId: "p1",
      agentId: "a1",
      role: "system",
      content: { text: "System notice" },
      createdAt: "2026-04-08T11:00:00.000Z",
    });

    const results = searchMessages("p1", "a1", "", {
      startDate: "2026-04-08",
      endDate: "2026-04-08",
    });
    expect(results.length).toBe(1);
    expect(results[0].role).toBe("user");
  });

  it("throws when neither query nor date range is given", () => {
    seedProject(db);
    expect(() => searchMessages("p1", "a1", "")).toThrow("query or a date range");
  });

  it("throws on invalid date inputs", () => {
    seedProject(db);
    expect(() => searchMessages("p1", "a1", "deploy", { startDate: "not-a-date" })).toThrow(
      "Invalid startDate",
    );
    expect(() => searchMessages("p1", "a1", "deploy", { endDate: "also-bad" })).toThrow(
      "Invalid endDate",
    );
  });

  it("throws on invalid limit or offset", () => {
    seedProject(db);
    expect(() => searchMessages("p1", "a1", "deploy", { limit: 0 })).toThrow("limit");
    expect(() => searchMessages("p1", "a1", "deploy", { offset: -1 })).toThrow("offset");
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
