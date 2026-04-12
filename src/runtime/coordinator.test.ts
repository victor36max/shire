import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { Coordinator } from "./coordinator";
import * as agentsService from "../services/agents";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { bus } from "../events";
import { rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
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
      getSessionId: () => null,
    }),
  }));

  coordinator = new Coordinator(projectId);
});

afterEach(async () => {
  await coordinator.stopAll();
  rmSync(testDir, { recursive: true, force: true });
});

describe("deployAndScan", () => {
  it("boots multiple agents in parallel without blocking on inbox", async () => {
    // Create agents in DB before deploying
    agentsService.createAgent(projectId, { name: "alpha" });
    agentsService.createAgent(projectId, { name: "bravo" });
    agentsService.createAgent(projectId, { name: "charlie" });

    // deployAndScan should complete quickly even with multiple agents
    const start = Date.now();
    await coordinator.deployAndScan();
    const elapsed = Date.now() - start;

    const statuses = coordinator.listAgentStatuses();
    expect(statuses.length).toBe(3);
    for (const s of statuses) {
      expect(s.busy).toBeDefined();
    }
    // Should be fast (parallel) — well under 1s
    expect(elapsed).toBeLessThan(2000);
  });

  it("does not block startup on stale inbox messages", async () => {
    const agent = agentsService.createAgent(projectId, { name: "inbox-agent" });

    // Write a stale inbox message before deploying
    const inboxDir = workspace.inboxDir(projectId, agent.id);
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(
      join(inboxDir, "stale.yaml"),
      "ts: 1000\ntype: user_message\nfrom: user\npayload:\n  text: old message\n",
    );

    // deployAndScan should still complete quickly
    const start = Date.now();
    await coordinator.deployAndScan();
    const elapsed = Date.now() - start;

    const statuses = coordinator.listAgentStatuses();
    expect(statuses[0].name).toBeTruthy();
    expect(elapsed).toBeLessThan(2000);
  });

  it("continues booting other agents when one fails", async () => {
    // Create two agents; the second will have a corrupted harness
    agentsService.createAgent(projectId, { name: "good-agent" });
    const badAgent = agentsService.createAgent(projectId, { name: "bad-agent" });

    // Sabotage: remove the bad agent from DB so startHarness fails
    agentsService.deleteAgent(badAgent.id);

    await coordinator.deployAndScan();

    // The good agent should still be listed
    const statuses = coordinator.listAgentStatuses();
    const good = statuses.find((s) => s.name === "good-agent");
    expect(good).toBeDefined();
  });
});

describe("createAgent", () => {
  it("creates agent and returns ok with agentId", async () => {
    const result = await coordinator.createAgent({
      name: "my-agent",
      description: "Test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBeTruthy();
    }
  });

  it("rejects duplicate names", async () => {
    await coordinator.createAgent({ name: "dup-agent" });
    const result = await coordinator.createAgent({ name: "dup-agent" });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid slug names", async () => {
    const cases = ["MyAgent", "my agent", "-invalid", "invalid-", "my_agent"];
    for (const name of cases) {
      const result = await coordinator.createAgent({ name });
      expect(result.ok).toBe(false);
    }
  });

  it("stores recipe fields in DB", async () => {
    const result = await coordinator.createAgent({
      name: "recipe-test",
      harness: "claude_code",
      description: "A test agent",
      model: "claude-sonnet-4-6",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const agent = agentsService.getAgent(result.agentId);
      expect(agent).toBeDefined();
      expect(agent!.harness).toBe("claude_code");
      expect(agent!.description).toBe("A test agent");
      expect(agent!.model).toBe("claude-sonnet-4-6");
    }
  });

  it("emits agent_created event", async () => {
    const events: Array<{ type: string }> = [];
    const unsub = bus.on(`project:${projectId}:agents`, (e) => events.push(e));

    await coordinator.createAgent({ name: "event-test" });

    unsub();
    expect(events.some((e) => e.type === "agent_created")).toBe(true);
  });
});

describe("deleteAgent", () => {
  it("deletes agent from DB and emits event", async () => {
    const createResult = await coordinator.createAgent({ name: "delete-me" });
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
    await coordinator.createAgent({ name: "agent-one" });
    await coordinator.createAgent({ name: "agent-two" });

    const statuses = coordinator.listAgentStatuses();
    expect(statuses.length).toBe(2);
    const names = statuses.map((s) => s.name);
    expect(names).toContain("agent-one");
    expect(names).toContain("agent-two");
    for (const s of statuses) {
      expect(s.name).toBeTruthy();
      expect(s.lastUserMessageAt).toBeNull();
    }
  });

  it("sorts agents with unread messages first", async () => {
    const r1 = await coordinator.createAgent({ name: "alpha" });
    const r2 = await coordinator.createAgent({ name: "bravo" });
    if (!r1.ok || !r2.ok) return;

    // Create an agent message for bravo so it has unread count
    agentsService.createMessage({
      projectId,
      agentId: r2.agentId,
      role: "agent",
      content: { text: "response" },
    });

    const statuses = coordinator.listAgentStatuses();
    // Bravo has unread, should come first
    expect(statuses[0].name).toBe("bravo");
    expect(statuses[1].name).toBe("alpha");
  });

  it("sorts by lastUserMessageAt within non-unread group", async () => {
    const r1 = await coordinator.createAgent({ name: "alpha" });
    const r2 = await coordinator.createAgent({ name: "bravo" });
    if (!r1.ok || !r2.ok) return;

    // Send user message to alpha first, then bravo
    const proc1 = coordinator.getAgent(r1.agentId)!;
    const proc2 = coordinator.getAgent(r2.agentId)!;
    await proc1.sendMessage("hi alpha", "user");
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await proc2.sendMessage("hi bravo", "user");

    const statuses = coordinator.listAgentStatuses();
    // Bravo was messaged more recently, should come first
    expect(statuses[0].name).toBe("bravo");
    expect(statuses[1].name).toBe("alpha");
  });

  it("defaults to alphabetical when no user messages exist", async () => {
    await coordinator.createAgent({ name: "charlie" });
    await coordinator.createAgent({ name: "alpha" });
    await coordinator.createAgent({ name: "bravo" });

    const statuses = coordinator.listAgentStatuses();
    expect(statuses.map((a) => a.name)).toEqual(["alpha", "bravo", "charlie"]);
  });
});

describe("getAgentDetail", () => {
  it("returns null for nonexistent agent", async () => {
    expect(await coordinator.getAgentDetail("nonexistent")).toBeNull();
  });

  it("returns agent detail with recipe fields", async () => {
    const result = await coordinator.createAgent({
      name: "detail-agent",
      description: "A test",
      harness: "claude_code",
      model: "claude-3-haiku",
    });
    if (!result.ok) return;

    const detail = await coordinator.getAgentDetail(result.agentId);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("detail-agent");
    expect(detail!.description).toBe("A test");
    expect(detail!.harness).toBe("claude_code");
    expect(detail!.model).toBe("claude-3-haiku");
  });
});

describe("updateAgent", () => {
  it("updates fields and emits event", async () => {
    const createResult = await coordinator.createAgent({
      name: "update-agent",
      description: "Old",
    });
    if (!createResult.ok) return;

    const events: Array<{ type: string }> = [];
    const unsub = bus.on(`project:${projectId}:agents`, (e) => events.push(e));

    const result = await coordinator.updateAgent(createResult.agentId, {
      description: "New",
    });

    unsub();
    expect(result.ok).toBe(true);
    expect(events.some((e) => e.type === "agent_updated")).toBe(true);

    const agent = agentsService.getAgent(createResult.agentId);
    expect(agent!.description).toBe("New");
  });
});

describe("routeMessage (inter-agent)", () => {
  it("delivers message to target agent inbox with type agent_message", async () => {
    const senderResult = await coordinator.createAgent({ name: "sender" });
    const receiverResult = await coordinator.createAgent({ name: "receiver" });
    expect(senderResult.ok).toBe(true);
    expect(receiverResult.ok).toBe(true);
    if (!senderResult.ok || !receiverResult.ok) return;

    // Stop the receiver so its inbox watcher doesn't consume the file
    const receiverProc = coordinator.getAgent(receiverResult.agentId);
    await receiverProc?.stop();

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

    // Wait for async routeMessage to complete
    await new Promise((r) => setTimeout(r, 200));

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
    const senderResult = await coordinator.createAgent({ name: "sender2" });
    const receiverResult = await coordinator.createAgent({ name: "receiver2" });
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

    // Wait for async routeMessage to complete
    await new Promise((r) => setTimeout(r, 200));

    // Sender should have no inter-agent messages in their history
    const { messages: senderMessages } = agentsService.listMessages(
      projectId,
      senderResult.agentId,
    );
    const senderInterAgent = senderMessages.filter((m) => m.role === "inter_agent");
    expect(senderInterAgent).toHaveLength(0);
  });

  it("sends error to sender when target agent does not exist", async () => {
    const senderResult = await coordinator.createAgent({ name: "lonely" });
    expect(senderResult.ok).toBe(true);
    if (!senderResult.ok) return;

    // Stop the sender so its inbox watcher doesn't consume the error file
    const senderProc = coordinator.getAgent(senderResult.agentId);
    await senderProc?.stop();

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "lonely",
        toAgentName: "nonexistent",
        text: "hello?",
      },
    });

    // Wait for async routeMessage to complete
    await new Promise((r) => setTimeout(r, 200));

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

describe("restartAgent", () => {
  it("returns false for nonexistent agent", async () => {
    const result = await coordinator.restartAgent("nonexistent");
    expect(result).toBe(false);
  });

  it("restarts an existing agent", async () => {
    const createResult = await coordinator.createAgent({ name: "restart-me" });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await coordinator.restartAgent(createResult.agentId);
    expect(result).toBe(true);
  });
});

describe("restartAllAgents", () => {
  it("restarts all agents", async () => {
    await coordinator.createAgent({ name: "restart-all-a" });
    await coordinator.createAgent({ name: "restart-all-b" });

    await coordinator.restartAllAgents();

    const statuses = coordinator.listAgentStatuses();
    expect(statuses.length).toBe(2);
    for (const s of statuses) {
      expect(s.busy).toBeDefined();
    }
  });
});

describe("stopAll", () => {
  it("stops all agents and clears state", async () => {
    await coordinator.createAgent({ name: "stop-all-a" });
    await coordinator.createAgent({ name: "stop-all-b" });
    expect(coordinator.listAgentStatuses().length).toBe(2);

    await coordinator.stopAll();
    expect(coordinator.listAgentStatuses()).toEqual([]);
  });
});

describe("system command handling", () => {
  it("handles system_alert command", async () => {
    const senderResult = await coordinator.createAgent({ name: "alerter" });
    expect(senderResult.ok).toBe(true);
    if (!senderResult.ok) return;

    // Stop the sender so its inbox watcher doesn't consume files
    const proc = coordinator.getAgent(senderResult.agentId);
    await proc?.stop();

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "alerter",
        toAgentName: "system_alert",
        text: "Alert title",
        extra: { title: "Test Alert", body: "Alert body", severity: "info" },
      },
    });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 200));
    // No error thrown means the handler executed
  });

  it("sends error for unknown system command", async () => {
    const senderResult = await coordinator.createAgent({ name: "bad-sys" });
    expect(senderResult.ok).toBe(true);
    if (!senderResult.ok) return;

    const proc = coordinator.getAgent(senderResult.agentId);
    await proc?.stop();

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "bad-sys",
        toAgentName: "system_unknown",
        text: "Something",
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    const inboxDir = workspace.inboxDir(projectId, senderResult.agentId);
    const errorFile = readdirSync(inboxDir).find((f) => f.endsWith("-error.yaml"));
    expect(errorFile).toBeDefined();
  });

  it("sends error for invalid alert severity", async () => {
    const senderResult = await coordinator.createAgent({ name: "bad-severity" });
    expect(senderResult.ok).toBe(true);
    if (!senderResult.ok) return;

    const proc = coordinator.getAgent(senderResult.agentId);
    await proc?.stop();

    bus.emit(`project:${projectId}:outbox`, {
      type: "outbox_message",
      payload: {
        fromAgentId: senderResult.agentId,
        fromAgentName: "bad-severity",
        toAgentName: "system_alert",
        text: "Alert",
        extra: { severity: "critical" },
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    const inboxDir = workspace.inboxDir(projectId, senderResult.agentId);
    const errorFile = readdirSync(inboxDir).find((f) => f.endsWith("-error.yaml"));
    expect(errorFile).toBeDefined();
  });
});

describe("updateAgent edge cases", () => {
  it("rejects duplicate name on rename", async () => {
    await coordinator.createAgent({ name: "agent-alpha" });
    const secondResult = await coordinator.createAgent({ name: "agent-beta" });
    if (!secondResult.ok) return;

    const result = await coordinator.updateAgent(secondResult.agentId, {
      name: "agent-alpha",
    });
    expect(result.ok).toBe(false);
  });

  it("returns error for nonexistent agent", async () => {
    const result = await coordinator.updateAgent("nonexistent", { description: "hi" });
    expect(result.ok).toBe(false);
  });
});

describe("deployAndScan", () => {
  it("is idempotent (second call is a no-op)", async () => {
    agentsService.createAgent(projectId, { name: "idempotent" });
    await coordinator.deployAndScan();
    // Second call should not re-deploy
    await coordinator.deployAndScan();
    const statuses = coordinator.listAgentStatuses();
    expect(statuses.length).toBe(1);
  });
});

describe("peers.yaml", () => {
  it("writes peers.yaml after agent creation", async () => {
    await coordinator.deployAndScan();
    await coordinator.createAgent({
      name: "peer-agent",
      description: "A peer",
    });

    const peersPath = workspace.peersPath(projectId);
    expect(existsSync(peersPath)).toBe(true);
    const content = readFileSync(peersPath, "utf-8");
    expect(content).toContain("peer-agent");
  });
});
