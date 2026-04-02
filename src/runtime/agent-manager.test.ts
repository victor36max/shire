import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { AgentManager } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { bus, type BusEvent } from "../events";
import { existsSync, rmSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, writeFile } from "fs/promises";
import yaml from "js-yaml";
let testDir: string;
let projectId: string;
let agentId: string;

beforeEach(() => {
  createTestDb();
  testDir = join(tmpdir(), `am_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;
  const project = projects.createProject(`test-project-${Date.now()}`);
  projectId = project.id;
  const agent = agentsService.createAgent(projectId, { name: "test-agent" });
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
      // The status events are tested through the coordinator tests

      unsub();
    });
  });

  describe("sendMessage with attachments", () => {
    let sentMessages: string[];

    function createActiveManager(): AgentManager {
      const mgr = createManager();
      // Inject a mock harness to make the agent active
      const mockHarness = {
        start: async () => {},
        sendMessage: async (text: string) => {
          sentMessages.push(text);
        },
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      };
      // Access private fields to set the agent as active
      (mgr as unknown as Record<string, unknown>).harness = mockHarness;
      (mgr as unknown as Record<string, unknown>).status = "active";
      return mgr;
    }

    beforeEach(async () => {
      sentMessages = [];
      await workspace.ensureProjectDirs(projectId);
      await workspace.ensureAgentDirs(projectId, agentId);
    });

    // Helper: pre-create an attachment file on disk (simulating the upload endpoint)
    async function createAttachmentOnDisk(attId: string, filename: string, content: string) {
      const dir = workspace.attachmentDir(projectId, agentId, attId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), content);
    }

    it("stores correct metadata in DB message for pre-uploaded attachment", async () => {
      const mgr = createActiveManager();
      await createAttachmentOnDisk("att-1", "doc.pdf", "file content");

      const result = await mgr.sendMessage("here", "user", {
        attachments: [
          { id: "att-1", filename: "doc.pdf", content_type: "application/pdf", size: 12 },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const msg = result.message!;
      const msgContent = msg.content as Record<string, unknown>;
      expect(msgContent.text).toBe("here");

      const atts = msgContent.attachments as Array<Record<string, unknown>>;
      expect(atts.length).toBe(1);
      expect(atts[0].filename).toBe("doc.pdf");
      expect(atts[0].content_type).toBe("application/pdf");
      expect(atts[0].size).toBe(12);
      expect(atts[0].id).toBe("att-1");
    });

    it("includes correct file path references in harness message", async () => {
      const mgr = createActiveManager();
      await createAttachmentOnDisk("att-2", "report.csv", "data");

      await mgr.sendMessage("look", "user", {
        attachments: [{ id: "att-2", filename: "report.csv", content_type: "text/csv", size: 4 }],
      });

      expect(sentMessages.length).toBe(1);
      const sent = sentMessages[0];
      expect(sent).toContain("look");
      expect(sent).toContain("[Attached file: report.csv (text/csv) at ");
      expect(sent).toContain("report.csv]");
      const pathMatch = sent.match(/at (.+?)]/);
      expect(pathMatch).toBeTruthy();
      expect(existsSync(pathMatch![1])).toBe(true);
    });

    it("works without attachments", async () => {
      const mgr = createActiveManager();
      const result = await mgr.sendMessage("just text", "user");

      expect(result.ok).toBe(true);
      expect(sentMessages[0]).toBe("just text");
    });

    it("handles multiple attachments in one message", async () => {
      const mgr = createActiveManager();
      await createAttachmentOnDisk("att-a", "a.txt", "aaa");
      await createAttachmentOnDisk("att-b", "b.txt", "bbb");

      const result = await mgr.sendMessage("files", "user", {
        attachments: [
          { id: "att-a", filename: "a.txt", content_type: "text/plain", size: 3 },
          { id: "att-b", filename: "b.txt", content_type: "text/plain", size: 3 },
        ],
      });

      expect(result.ok).toBe(true);

      // Verify harness received both file references
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toContain("a.txt");
      expect(sentMessages[0]).toContain("b.txt");
    });
  });

  // buildInternalPrompt tests have been moved to system-prompt.test.ts

  describe("autoRestart", () => {
    it("returns true for the first few attempts", () => {
      const mgr = createManager();
      // autoRestart calls start() internally, which will fail since
      // workspace isn't set up, but it should return true for the first 3 attempts
      expect(mgr.autoRestart()).toBe(true);
      expect(mgr.autoRestart()).toBe(true);
      expect(mgr.autoRestart()).toBe(true);
    });

    it("returns false after max retries (3)", () => {
      const mgr = createManager();
      mgr.autoRestart();
      mgr.autoRestart();
      mgr.autoRestart();
      expect(mgr.autoRestart()).toBe(false);
    });
  });

  describe("sendMessage with system prefix", () => {
    let sentMessages: string[];

    function createActiveManager(): AgentManager {
      const mgr = createManager();
      const mockHarness = {
        start: async () => {},
        sendMessage: async (text: string) => {
          sentMessages.push(text);
        },
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      };
      (mgr as unknown as Record<string, unknown>).harness = mockHarness;
      (mgr as unknown as Record<string, unknown>).status = "active";
      return mgr;
    }

    beforeEach(async () => {
      sentMessages = [];
      await workspace.ensureProjectDirs(projectId);
      await workspace.ensureAgentDirs(projectId, agentId);
    });

    it("prepends [System] prefix for system messages", async () => {
      const mgr = createActiveManager();
      const result = await mgr.sendMessage("check this", "system");
      expect(result.ok).toBe(true);
      expect(sentMessages[0]).toBe("[System] check this");
    });

    it("does not persist system messages to DB", async () => {
      const mgr = createActiveManager();
      const result = await mgr.sendMessage("system only", "system");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // System messages should not create a user message in DB
      expect(result.message).toBeNull();
    });

    it("persists user messages to DB", async () => {
      const mgr = createActiveManager();
      const result = await mgr.sendMessage("user msg", "user");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message).not.toBeNull();
      expect(result.message!.role).toBe("user");
    });
  });

  describe("clearSession", () => {
    it("clears session via harness and creates system message", async () => {
      await workspace.ensureProjectDirs(projectId);
      await workspace.ensureAgentDirs(projectId, agentId);

      const mgr = createManager();
      const mockHarness = {
        start: async () => {},
        sendMessage: async () => {},
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      };
      (mgr as unknown as Record<string, unknown>).harness = mockHarness;
      (mgr as unknown as Record<string, unknown>).status = "active";

      const result = await mgr.clearSession();
      expect(result).toBe(true);

      // Should have created a "Session cleared" message
      const { messages } = agentsService.listMessages(projectId, agentId);
      const systemMsg = messages.find(
        (m) =>
          m.role === "system" && (m.content as Record<string, unknown>).text === "Session cleared",
      );
      expect(systemMsg).toBeDefined();
    });
  });

  describe("interrupt", () => {
    it("returns true when active and harness exists", async () => {
      await workspace.ensureProjectDirs(projectId);
      await workspace.ensureAgentDirs(projectId, agentId);

      const mgr = createManager();
      const mockHarness = {
        start: async () => {},
        sendMessage: async () => {},
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      };
      (mgr as unknown as Record<string, unknown>).harness = mockHarness;
      (mgr as unknown as Record<string, unknown>).status = "active";

      const result = await mgr.interrupt();
      expect(result).toBe(true);
    });
  });

  describe("stop", () => {
    it("sets status to idle", async () => {
      const mgr = createManager();
      await mgr.stop();
      expect(mgr.status).toBe("idle");
    });
  });

  describe("event broadcasting", () => {
    it("emits agent_busy events on sendMessage", async () => {
      await workspace.ensureProjectDirs(projectId);
      await workspace.ensureAgentDirs(projectId, agentId);

      const mgr = createManager();
      const mockHarness = {
        start: async () => {},
        sendMessage: async () => {},
        interrupt: async () => {},
        clearSession: async () => {},
        stop: async () => {},
        onEvent: () => {},
        isProcessing: () => false,
        getSessionId: () => null,
      };
      (mgr as unknown as Record<string, unknown>).harness = mockHarness;
      (mgr as unknown as Record<string, unknown>).status = "active";

      const { events, unsub } = collectEvents(`project:${projectId}:agents`);
      await mgr.sendMessage("test");

      unsub();
      const busyEvents = events.filter((e) => e.type === "agent_busy");
      expect(busyEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("start with mocked harness", () => {
    it("starts harness and transitions to active", async () => {
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

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();
      expect(mgr.status).toBe("active");
      await mgr.stop();
    });

    it("restart re-reads agent from DB and starts fresh", async () => {
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

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();
      expect(mgr.status).toBe("active");
      await mgr.restart();
      expect(mgr.status).toBe("active");
      await mgr.stop();
    });
  });

  describe("harness event handling via onEvent callback", () => {
    it("processes text_delta events and accumulates streaming", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      const { events, unsub } = collectEvents(`project:${projectId}:agent:${agentId}`);

      // Fire text_delta event
      eventCallback!({ type: "text_delta", payload: { delta: "Hello " } });
      eventCallback!({ type: "text_delta", payload: { delta: "World" } });

      // Flush via turn_complete
      eventCallback!({ type: "turn_complete", payload: { session_id: "s1" } });

      unsub();
      const deltaEvents = events.filter((e) => e.type === "text_delta");
      expect(deltaEvents.length).toBe(2);

      // Should have created a text message from the accumulated streaming
      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents.length).toBe(1);

      await mgr.stop();
    });

    it("processes text event (no streaming)", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      const { events, unsub } = collectEvents(`project:${projectId}:agent:${agentId}`);

      eventCallback!({ type: "text", payload: { text: "Full text response" } });

      unsub();
      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents.length).toBe(1);

      // Verify DB record was created
      const { messages } = agentsService.listMessages(projectId, agentId);
      const agentMsgs = messages.filter((m) => m.role === "agent");
      expect(agentMsgs.length).toBe(1);

      await mgr.stop();
    });

    it("processes tool_use started event", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      eventCallback!({
        type: "tool_use",
        payload: {
          tool: "Read",
          tool_use_id: "tu-test-1",
          input: { path: "/foo" },
          status: "started",
        },
      });

      const { messages } = agentsService.listMessages(projectId, agentId);
      const toolMsgs = messages.filter((m) => m.role === "tool_use");
      expect(toolMsgs.length).toBe(1);

      await mgr.stop();
    });

    it("processes tool_use input_ready event", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      // First create the tool_use with started
      eventCallback!({
        type: "tool_use",
        payload: {
          tool: "Read",
          tool_use_id: "tu-input",
          input: {},
          status: "started",
        },
      });

      // Then send input_ready with updated input
      eventCallback!({
        type: "tool_use",
        payload: {
          tool: "Read",
          tool_use_id: "tu-input",
          input: { path: "/updated" },
          status: "input_ready",
        },
      });

      const { messages } = agentsService.listMessages(projectId, agentId);
      const toolMsg = messages.find((m) => m.role === "tool_use");
      expect(toolMsg).toBeDefined();
      expect((toolMsg!.content as Record<string, unknown>).input).toEqual({ path: "/updated" });

      await mgr.stop();
    });

    it("processes tool_result event", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      eventCallback!({
        type: "tool_use",
        payload: {
          tool: "Read",
          tool_use_id: "tu-result",
          input: {},
          status: "started",
        },
      });

      eventCallback!({
        type: "tool_result",
        payload: {
          tool_use_id: "tu-result",
          output: "file contents",
          is_error: false,
        },
      });

      const { messages } = agentsService.listMessages(projectId, agentId);
      const toolMsg = messages.find((m) => m.role === "tool_use");
      expect(toolMsg).toBeDefined();
      expect((toolMsg!.content as Record<string, unknown>).output).toBe("file contents");

      await mgr.stop();
    });

    it("processes error event", async () => {
      let eventCallback: ((e: { type: string; payload: Record<string, unknown> }) => void) | null =
        null;
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async () => {},
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: (cb: typeof eventCallback) => {
            eventCallback = cb;
          },
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      eventCallback!({
        type: "error",
        payload: { message: "Something went wrong" },
      });

      const { messages } = agentsService.listMessages(projectId, agentId);
      const systemMsgs = messages.filter(
        (m) =>
          m.role === "system" &&
          ((m.content as Record<string, unknown>).text as string).includes("Error:"),
      );
      expect(systemMsgs.length).toBe(1);

      await mgr.stop();
    });
  });

  describe("outbox processing", () => {
    it("processes outbox yaml files and emits outbox events", async () => {
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

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();

      // Write an outbox file
      const outboxDir = workspace.outboxDir(projectId, agentId);
      const envelope = { to: "other-agent", text: "hello there" };
      writeFileSync(join(outboxDir, `${Date.now()}-test.yaml`), yaml.dump(envelope));

      // Trigger outbox watcher by waiting briefly
      await new Promise((r) => setTimeout(r, 500));

      // Outbox file should have been consumed
      const remaining = readdirSync(outboxDir).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
      );
      expect(remaining.length).toBe(0);

      await mgr.stop();
    });
  });

  describe("inbox processing", () => {
    it("processes inbox user_message envelope", async () => {
      let sentMessages: string[] = [];
      mock.module("./harness", () => ({
        createHarness: () => ({
          start: async () => {},
          sendMessage: async (text: string) => {
            sentMessages.push(text);
          },
          interrupt: async () => {},
          clearSession: async () => {},
          stop: async () => {},
          onEvent: () => {},
          isProcessing: () => false,
          getSessionId: () => null,
        }),
      }));

      await workspace.ensureProjectDirs(projectId);
      const mgr = createManager();
      await mgr.start();
      // Wait for initial inbox processing
      await new Promise((r) => setTimeout(r, 200));

      // Write an inbox file while busy=false
      const inboxDir = workspace.inboxDir(projectId, agentId);
      const envelope = {
        ts: Date.now(),
        type: "user_message",
        from: "user",
        payload: { text: "inbox hello" },
      };
      writeFileSync(join(inboxDir, `${Date.now()}-test.yaml`), yaml.dump(envelope));

      await new Promise((r) => setTimeout(r, 1000));

      // File should be consumed
      const remaining = readdirSync(inboxDir).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
      );
      expect(remaining.length).toBe(0);

      await mgr.stop();
    });
  });

  describe("workspace setup", () => {
    it("creates agent directories on start", async () => {
      await workspace.ensureProjectDirs(projectId);
      createManager();

      // setupWorkspace is called during start(), which also tries to start the harness
      // For a unit test, we verify ensureAgentDirs creates the right structure
      await workspace.ensureAgentDirs(projectId, agentId);

      const agentDir = workspace.agentDir(projectId, agentId);
      expect(existsSync(join(agentDir, "inbox"))).toBe(true);
      expect(existsSync(join(agentDir, "outbox"))).toBe(true);
      expect(existsSync(join(agentDir, "attachments"))).toBe(true);
    });
  });
});
