import { describe, it, expect } from "bun:test";
import { createTestDb } from "../test/setup";
import * as projectsService from "../services/projects";
import * as agentsService from "../services/agents";
import { getDb, schema } from "./index";

describe("schema $defaultFn callbacks", () => {
  it("projects.id generates a UUID when not provided", () => {
    createTestDb();
    const project = projectsService.createProject("test-default-id");
    expect(project.id).toBeTruthy();
    // UUID format
    expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("agents.id generates a UUID when not provided", () => {
    createTestDb();
    const project = projectsService.createProject("agent-default-id");
    const agent = agentsService.createAgent(project.id, { name: "test-agent" });
    expect(agent.id).toBeTruthy();
    expect(agent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("scheduledTasks.id generates a UUID when not provided", () => {
    createTestDb();
    const project = projectsService.createProject("task-default-id");
    const agent = agentsService.createAgent(project.id, { name: "task-agent" });
    const result = getDb()
      .insert(schema.scheduledTasks)
      .values({
        projectId: project.id,
        agentId: agent.id,
        label: "test-task",
        message: "test",
        scheduleType: "once",
        scheduledAt: new Date().toISOString(),
      })
      .returning()
      .get();
    expect(result.id).toBeTruthy();
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("alertChannels.id generates a UUID when not provided", () => {
    createTestDb();
    const project = projectsService.createProject("alert-default-id");
    const result = getDb()
      .insert(schema.alertChannels)
      .values({
        projectId: project.id,
        channelType: "discord",
        config: { type: "discord", webhookUrl: "https://example.com/webhook" },
      })
      .returning()
      .get();
    expect(result.id).toBeTruthy();
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
