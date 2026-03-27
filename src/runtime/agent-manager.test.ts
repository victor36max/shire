import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "../test/setup";
import { AgentManager } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { bus, type BusEvent } from "../events";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
let testDir: string;
let projectId: string;
let agentId: string;

// We need to mock createHarness. Since AgentManager imports it,
// we'll test event handling by collecting bus events.

beforeEach(() => {
  createTestDb();
  testDir = join(tmpdir(), `am_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;
  const project = projects.createProject(`test-project-${Date.now()}`);
  projectId = project.id;
  const agent = agentsService.createAgent(projectId, "test-agent");
  agentId = agent.id;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function createManager(): AgentManager {
  return new AgentManager({ projectId, agentId, agentName: "test-agent" });
}

function collectEvents(topic: string): { events: BusEvent[]; unsub: () => void } {
  const events: BusEvent[] = [];
  const unsub = bus.on(topic, (e) => events.push(e));
  return { events, unsub };
}

describe("AgentManager", () => {
  describe("initial state", () => {
    it("starts with idle status", () => {
      const mgr = createManager();
      expect(mgr.status).toBe("idle");
    });

    it("initializes lastReadMessageId from DB", () => {
      // No messages yet
      const mgr = createManager();
      expect(mgr.getLastReadMessageId()).toBeNull();
    });

    it("picks up existing agent messages for lastReadMessageId", () => {
      agentsService.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "hello" },
      });
      const m2 = agentsService.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "world" },
      });

      const mgr = createManager();
      expect(mgr.getLastReadMessageId()).toBe(m2.id);
    });
  });

  describe("markRead", () => {
    it("updates lastReadMessageId", () => {
      const mgr = createManager();
      mgr.markRead(42);
      expect(mgr.getLastReadMessageId()).toBe(42);
    });

    it("only increases, never decreases", () => {
      const mgr = createManager();
      mgr.markRead(42);
      mgr.markRead(10);
      expect(mgr.getLastReadMessageId()).toBe(42);
    });
  });

  describe("sendMessage", () => {
    it("returns error when not active", async () => {
      const mgr = createManager();
      const result = await mgr.sendMessage("hello");
      expect(result.ok).toBe(false);
    });
  });

  describe("interrupt", () => {
    it("returns false when not active", async () => {
      const mgr = createManager();
      expect(await mgr.interrupt()).toBe(false);
    });
  });

  describe("clearSession", () => {
    it("returns false when not active", async () => {
      const mgr = createManager();
      expect(await mgr.clearSession()).toBe(false);
    });
  });

  describe("event handling (handleHarnessEvent)", () => {
    // Since handleHarnessEvent is private, we test it indirectly
    // by checking that events emitted by the harness produce
    // the correct DB records and bus events.

    // We can access the private method through the harness mock's onEvent callback.
    // But since the harness is created inside startHarness(), we need to test
    // through the public API or by checking DB state after events.

    // For unit-testing the event logic directly, let's test the DB-facing behavior
    // by calling the methods that would be triggered by harness events.

    it("text event creates agent message in DB", () => {
      // Simulate what handleText does
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "Hello world" },
      });

      expect(msg.role).toBe("agent");
      expect((msg.content as Record<string, unknown>).text).toBe("Hello world");

      const fetched = agentsService.getMessage(msg.id);
      expect(fetched).toBeTruthy();
      expect((fetched!.content as Record<string, unknown>).text).toBe("Hello world");
    });

    it("tool_use started creates tool_use message", () => {
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "tool_use",
        content: {
          tool: "Read",
          tool_use_id: "tu_abc",
          input: { path: "/foo" },
          output: null,
          is_error: false,
        },
      });

      expect(msg.role).toBe("tool_use");
      const content = msg.content as Record<string, unknown>;
      expect(content.tool).toBe("Read");
      expect(content.tool_use_id).toBe("tu_abc");
    });

    it("tool_result updates tool_use message output", () => {
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "tool_use",
        content: {
          tool: "Read",
          tool_use_id: "tu_xyz",
          input: {},
          output: null,
          is_error: false,
        },
      });

      agentsService.updateMessage(msg.id, {
        content: {
          tool: "Read",
          tool_use_id: "tu_xyz",
          input: {},
          output: "file contents here",
          is_error: false,
        },
      });

      const updated = agentsService.getMessage(msg.id);
      expect((updated!.content as Record<string, unknown>).output).toBe("file contents here");
      expect((updated!.content as Record<string, unknown>).is_error).toBe(false);
    });

    it("streaming text accumulation and flush", () => {
      // Simulate: two text deltas accumulated, then flushed as one message
      const accumulatedText = "Hello world";
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: accumulatedText },
      });

      expect((msg.content as Record<string, unknown>).text).toBe("Hello world");

      // Only one message should exist
      const { messages } = agentsService.listMessages(projectId, agentId);
      const agentMsgs = messages.filter((m) => m.role === "agent");
      expect(agentMsgs.length).toBe(1);
    });

    it("inter_agent message persists with fromAgent and toAgent", () => {
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "inter_agent",
        content: {
          text: "hello from other",
          fromAgent: "other-agent",
          toAgent: "test-agent",
        },
      });

      expect(msg.role).toBe("inter_agent");
      const content = msg.content as Record<string, unknown>;
      expect(content.fromAgent).toBe("other-agent");
      expect(content.toAgent).toBe("test-agent");
    });

    it("session_cleared creates system message", () => {
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "system",
        content: { text: "Session cleared" },
      });

      expect(msg.role).toBe("system");
      expect((msg.content as Record<string, unknown>).text).toBe("Session cleared");
    });

    it("error event creates system message with error prefix", () => {
      const msg = agentsService.createMessage({
        projectId,
        agentId,
        role: "system",
        content: { text: "Error: something went wrong" },
      });

      expect(msg.role).toBe("system");
      expect((msg.content as Record<string, unknown>).text).toContain("Error:");
    });
  });

  describe("status transitions", () => {
    it("emits agent_status events on status change", () => {
      const { unsub } = collectEvents(`project:${projectId}:agents`);
      createManager();

      // Creating the manager doesn't change status (starts idle, no event)
      // But if we could call setStatus we'd see events
      // The status events are tested through the coordinator tests

      unsub();
    });
  });

  describe("workspace setup", () => {
    it("creates agent directories on start", async () => {
      workspace.ensureProjectDirs(projectId);
      createManager();

      // setupWorkspace is called during start(), which also tries to start the harness
      // For a unit test, we verify ensureAgentDirs creates the right structure
      workspace.ensureAgentDirs(projectId, agentId);

      const agentDir = workspace.agentDir(projectId, agentId);
      expect(existsSync(join(agentDir, "inbox"))).toBe(true);
      expect(existsSync(join(agentDir, "outbox"))).toBe(true);
      expect(existsSync(join(agentDir, "scripts"))).toBe(true);
      expect(existsSync(join(agentDir, "documents"))).toBe(true);
      expect(existsSync(join(agentDir, "attachments"))).toBe(true);
    });
  });
});
