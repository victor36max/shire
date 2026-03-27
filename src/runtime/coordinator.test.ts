import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { Coordinator } from "./coordinator";
import * as agentsService from "../services/agents";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { bus } from "../events";
import { rmSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { tmpdir } from "os";

let testDir: string;
let projectId: string;
let coordinator: Coordinator;

beforeEach(() => {
  createTestDb();
  testDir = join(tmpdir(), `coord_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;

  const project = projects.createProject("test-project");
  projectId = project.id;

  // Mock the harness so agents don't actually start LLM sessions
  mock.module("./harness", () => ({
    createHarness: () => ({
      start: async () => {},
      sendMessage: async () => {},
      interrupt: async () => {},
      clearSession: async () => {},
      stop: async () => {},
      onEvent: () => {},
      isProcessing: () => false,
    }),
  }));

  coordinator = new Coordinator(projectId);
});

afterEach(async () => {
  coordinator.stopAll();
  rmSync(testDir, { recursive: true, force: true });
});

describe("createAgent", () => {
  it("creates agent and returns ok with agentId", async () => {
    const result = await coordinator.createAgent({
      name: "my-agent",
      recipeYaml: "name: my-agent\ndescription: Test\n",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBeTruthy();
    }
  });

  it("rejects duplicate names", async () => {
    await coordinator.createAgent({
      name: "dup-agent",
      recipeYaml: "name: dup-agent\n",
    });
    const result = await coordinator.createAgent({
      name: "dup-agent",
      recipeYaml: "name: dup-agent\n",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid slug names", async () => {
    const cases = ["MyAgent", "my agent", "-invalid", "invalid-", "my_agent"];
    for (const name of cases) {
      const result = await coordinator.createAgent({
        name,
        recipeYaml: `name: ${name}\n`,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("writes recipe.yaml to workspace", async () => {
    const result = await coordinator.createAgent({
      name: "recipe-test",
      recipeYaml: "name: recipe-test\nharness: claude_code\n",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const recipePath = workspace.recipePath(projectId, result.agentId);
      expect(existsSync(recipePath)).toBe(true);
      const content = readFileSync(recipePath, "utf-8");
      expect(content).toContain("recipe-test");
    }
  });

  it("emits agent_created event", async () => {
    const events: Array<{ type: string }> = [];
    const unsub = bus.on(`project:${projectId}:agents`, (e) => events.push(e));

    await coordinator.createAgent({
      name: "event-test",
      recipeYaml: "name: event-test\n",
    });

    unsub();
    expect(events.some((e) => e.type === "agent_created")).toBe(true);
  });
});

describe("deleteAgent", () => {
  it("deletes agent from DB and emits event", async () => {
    const createResult = await coordinator.createAgent({
      name: "delete-me",
      recipeYaml: "name: delete-me\n",
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const events: Array<{ type: string }> = [];
    const unsub = bus.on(`project:${projectId}:agents`, (e) => events.push(e));

    await coordinator.deleteAgent(createResult.agentId);
    unsub();

    expect(agentsService.getAgent(createResult.agentId)).toBeUndefined();
    expect(events.some((e) => e.type === "agent_deleted")).toBe(true);
  });
});

describe("listAgentStatuses", () => {
  it("returns empty list when no agents", () => {
    expect(coordinator.listAgentStatuses()).toEqual([]);
  });

  it("returns agents with status", async () => {
    await coordinator.createAgent({
      name: "agent-one",
      recipeYaml: "name: agent-one\n",
    });
    await coordinator.createAgent({
      name: "agent-two",
      recipeYaml: "name: agent-two\n",
    });

    const statuses = coordinator.listAgentStatuses();
    expect(statuses.length).toBe(2);
    const names = statuses.map((s) => s.name);
    expect(names).toContain("agent-one");
    expect(names).toContain("agent-two");
    for (const s of statuses) {
      expect(s.status).toBeTruthy();
    }
  });
});

describe("getAgentDetail", () => {
  it("returns null for nonexistent agent", () => {
    expect(coordinator.getAgentDetail("nonexistent")).toBeNull();
  });

  it("returns agent detail with recipe fields", async () => {
    const result = await coordinator.createAgent({
      name: "detail-agent",
      recipeYaml:
        "name: detail-agent\ndescription: A test\nharness: claude_code\nmodel: claude-3-haiku\n",
    });
    if (!result.ok) return;

    const detail = coordinator.getAgentDetail(result.agentId);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("detail-agent");
    expect(detail!.description).toBe("A test");
    expect(detail!.harness).toBe("claude_code");
    expect(detail!.model).toBe("claude-3-haiku");
    expect(detail!.status).toBeTruthy();
  });
});

describe("updateAgent", () => {
  it("updates recipe and emits event", async () => {
    const createResult = await coordinator.createAgent({
      name: "update-agent",
      recipeYaml: "name: update-agent\ndescription: Old\n",
    });
    if (!createResult.ok) return;

    const events: Array<{ type: string }> = [];
    const unsub = bus.on(`project:${projectId}:agents`, (e) => events.push(e));

    const result = await coordinator.updateAgent(createResult.agentId, {
      recipeYaml: "name: update-agent\ndescription: New\n",
    });

    unsub();
    expect(result.ok).toBe(true);
    expect(events.some((e) => e.type === "agent_updated")).toBe(true);
  });
});

describe("routeMessage (inter-agent)", () => {
  it("delivers message to target agent inbox with type agent_message", async () => {
    const senderResult = await coordinator.createAgent({
      name: "sender",
      recipeYaml: "name: sender\n",
    });
    const receiverResult = await coordinator.createAgent({
      name: "receiver",
      recipeYaml: "name: receiver\n",
    });
    expect(senderResult.ok).toBe(true);
    expect(receiverResult.ok).toBe(true);
    if (!senderResult.ok || !receiverResult.ok) return;

    // Trigger the outbox event that the coordinator listens on
    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "sender",
        toAgentName: "receiver",
        text: "hello from sender",
      },
    });

    // Check that a YAML file was written to receiver's inbox
    const inboxDir = workspace.inboxDir(projectId, receiverResult.agentId);
    const deliveryFile = readdirSync(inboxDir).find((f) => f.endsWith("-sender.yaml"));
    expect(deliveryFile).toBeDefined();

    const envelope = yaml.load(readFileSync(join(inboxDir, deliveryFile!), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(envelope.type).toBe("agent_message");
    expect(envelope.from).toBe("sender");
    expect((envelope.payload as Record<string, unknown>).text).toBe("hello from sender");
  });

  it("does not persist inter-agent message in sender's message history", async () => {
    const senderResult = await coordinator.createAgent({
      name: "sender2",
      recipeYaml: "name: sender2\n",
    });
    const receiverResult = await coordinator.createAgent({
      name: "receiver2",
      recipeYaml: "name: receiver2\n",
    });
    expect(senderResult.ok).toBe(true);
    expect(receiverResult.ok).toBe(true);
    if (!senderResult.ok || !receiverResult.ok) return;

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "sender2",
        toAgentName: "receiver2",
        text: "hi there",
      },
    });

    // Sender should have no inter-agent messages in their history
    const { messages: senderMessages } = agentsService.listMessages(
      projectId,
      senderResult.agentId,
    );
    const senderInterAgent = senderMessages.filter((m) => m.role === "inter_agent");
    expect(senderInterAgent).toHaveLength(0);
  });

  it("sends error to sender when target agent does not exist", async () => {
    const senderResult = await coordinator.createAgent({
      name: "lonely",
      recipeYaml: "name: lonely\n",
    });
    expect(senderResult.ok).toBe(true);
    if (!senderResult.ok) return;

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "lonely",
        toAgentName: "nonexistent",
        text: "hello?",
      },
    });

    const inboxDir = workspace.inboxDir(projectId, senderResult.agentId);
    const errorFile = readdirSync(inboxDir).find((f) => f.endsWith("-error.yaml"));
    expect(errorFile).toBeDefined();

    const envelope = yaml.load(readFileSync(join(inboxDir, errorFile!), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(envelope.type).toBe("system_message");
    expect(((envelope.payload as Record<string, unknown>).text as string).toLowerCase()).toContain(
      "not found",
    );
  });
});

describe("peers.yaml", () => {
  it("writes peers.yaml after agent creation", async () => {
    await coordinator.deployAndScan();
    await coordinator.createAgent({
      name: "peer-agent",
      recipeYaml: "name: peer-agent\ndescription: A peer\n",
    });

    const peersPath = workspace.peersPath(projectId);
    expect(existsSync(peersPath)).toBe(true);
    const content = readFileSync(peersPath, "utf-8");
    expect(content).toContain("peer-agent");
  });
});
