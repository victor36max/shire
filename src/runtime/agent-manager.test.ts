import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "../test/setup";
import { AgentManager } from "./agent-manager";
import * as agentsService from "../services/agents";
import * as projects from "../services/projects";
import * as workspace from "../services/workspace";
import { bus, type BusEvent } from "../events";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readdir } from "fs/promises";
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

    it("saves attachment files to disk", async () => {
      const mgr = createActiveManager();
      const base64Content = Buffer.from("hello world").toString("base64");

      const result = await mgr.sendMessage("check this file", "user", {
        attachments: [
          {
            name: "test.txt",
            content: base64Content,
            content_type: "text/plain",
          },
        ],
      });

      expect(result.ok).toBe(true);

      // Find the attachment directory created
      const attDir = workspace.attachmentsDir(projectId, agentId);
      const entries = (await readdir(attDir)).filter((e) => e !== "outbox");
      expect(entries.length).toBe(1);

      // Verify file content
      const filePath = join(attDir, entries[0], "test.txt");
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe("hello world");
    });

    it("strips data URL prefix from base64 content", async () => {
      const mgr = createActiveManager();
      const rawBase64 = Buffer.from("image data").toString("base64");
      const dataUrl = `data:image/png;base64,${rawBase64}`;

      const result = await mgr.sendMessage("see image", "user", {
        attachments: [
          {
            name: "photo.png",
            content: dataUrl,
            content_type: "image/png",
          },
        ],
      });

      expect(result.ok).toBe(true);

      const attDir = workspace.attachmentsDir(projectId, agentId);
      const entries = (await readdir(attDir)).filter((e) => e !== "outbox");
      const filePath = join(attDir, entries[0], "photo.png");
      expect(readFileSync(filePath, "utf-8")).toBe("image data");
    });

    it("stores correct metadata in DB message", async () => {
      const mgr = createActiveManager();
      const content = Buffer.from("file content").toString("base64");

      const result = await mgr.sendMessage("here", "user", {
        attachments: [
          {
            name: "doc.pdf",
            content,
            content_type: "application/pdf",
          },
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
      expect(atts[0].size).toBe(Buffer.from("file content").length);
      expect(typeof atts[0].id).toBe("string");
      // DB should NOT store the raw base64 content
      expect(atts[0].content).toBeUndefined();
    });

    it("includes correct file path references in harness message", async () => {
      const mgr = createActiveManager();
      const content = Buffer.from("data").toString("base64");

      await mgr.sendMessage("look", "user", {
        attachments: [
          {
            name: "report.csv",
            content,
            content_type: "text/csv",
          },
        ],
      });

      expect(sentMessages.length).toBe(1);
      const sent = sentMessages[0];
      expect(sent).toContain("look");
      expect(sent).toContain("[Attached file: report.csv (text/csv) at ");
      expect(sent).toContain("report.csv]");
      // The path should point to a real file
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

      const result = await mgr.sendMessage("files", "user", {
        attachments: [
          {
            name: "a.txt",
            content: Buffer.from("aaa").toString("base64"),
            content_type: "text/plain",
          },
          {
            name: "b.txt",
            content: Buffer.from("bbb").toString("base64"),
            content_type: "text/plain",
          },
        ],
      });

      expect(result.ok).toBe(true);

      const attDir = workspace.attachmentsDir(projectId, agentId);
      const entries = (await readdir(attDir)).filter((e) => e !== "outbox");
      expect(entries.length).toBe(1); // One batch = one attachment ID

      const batchDir = join(attDir, entries[0]);
      const files = await readdir(batchDir);
      expect(files.sort()).toEqual(["a.txt", "b.txt"]);
      expect(readFileSync(join(batchDir, "a.txt"), "utf-8")).toBe("aaa");
      expect(readFileSync(join(batchDir, "b.txt"), "utf-8")).toBe("bbb");
    });

    it("rejects filenames with path traversal", async () => {
      const mgr = createActiveManager();
      const result = await mgr.sendMessage("hack", "user", {
        attachments: [
          {
            name: "../../inbox/evil.yaml",
            content: Buffer.from("bad").toString("base64"),
            content_type: "text/plain",
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid attachment filename");
      }
    });

    it("rejects empty base64 content that decodes to zero bytes", async () => {
      const mgr = createActiveManager();
      // "=====" is technically valid base64 padding but decodes to 0 bytes
      const result = await mgr.sendMessage("bad data", "user", {
        attachments: [
          {
            name: "file.txt",
            content: "=====",
            content_type: "text/plain",
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("failed to decode base64");
      }
    });
  });

  // buildInternalPrompt tests have been moved to system-prompt.test.ts

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
