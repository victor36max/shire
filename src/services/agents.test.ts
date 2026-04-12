import { describe, it, expect, beforeEach } from "bun:test";
import { useTestDb } from "../test/setup";
import { getDb } from "../db";
import * as agents from "./agents";
import * as projects from "./projects";

describe("agents service", () => {
  useTestDb();

  let projectId: string;
  let agentId: string;
  let agent2Id: string;

  beforeEach(() => {
    const project = projects.createProject("test-project");
    projectId = project.id;
    const agent = agents.createAgent(projectId, { name: "test-agent" });
    agentId = agent.id;
    const agent2 = agents.createAgent(projectId, { name: "chat-agent" });
    agent2Id = agent2.id;
  });

  describe("createMessage", () => {
    it("creates a message with valid data", () => {
      const msg = agents.createMessage({
        projectId,
        agentId,
        role: "user",
        content: { text: "hi" },
      });
      expect(msg.role).toBe("user");
      expect((msg.content as Record<string, unknown>).text).toBe("hi");
      expect(msg.agentId).toBe(agentId);
      expect(msg.projectId).toBe(projectId);
    });
  });

  describe("listMessages", () => {
    it("returns messages oldest first", () => {
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "user",
        content: { text: "first" },
      });
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "agent",
        content: { text: "second" },
      });

      const { messages } = agents.listMessages(projectId, agent2Id);
      expect(messages.length).toBe(2);
      expect((messages[0].content as Record<string, unknown>).text).toBe("first");
      expect((messages[1].content as Record<string, unknown>).text).toBe("second");
    });
  });

  describe("listInterAgentMessages", () => {
    it("returns only inter_agent messages", () => {
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "user",
        content: { text: "hi" },
      });
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "inter_agent",
        content: { text: "Hello from Alice", from_agent: "Alice", to_agent: "chat-agent" },
      });

      const { messages } = agents.listInterAgentMessages(projectId);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("inter_agent");
      expect((messages[0].content as Record<string, unknown>).from_agent).toBe("Alice");
    });

    it("supports cursor-based pagination", () => {
      for (let i = 1; i <= 3; i++) {
        agents.createMessage({
          projectId,
          agentId: agent2Id,
          role: "inter_agent",
          content: { text: `msg-${i}`, from_agent: "Alice", to_agent: "chat-agent" },
        });
      }

      const { messages: firstPage, hasMore } = agents.listInterAgentMessages(projectId, {
        limit: 2,
      });
      expect(firstPage.length).toBe(2);
      expect(hasMore).toBe(true);

      const oldestId = firstPage[firstPage.length - 1].id;
      const { messages: secondPage, hasMore: hasMore2 } = agents.listInterAgentMessages(projectId, {
        before: oldestId,
        limit: 2,
      });
      expect(secondPage.length).toBe(1);
      expect(hasMore2).toBe(false);
    });
  });

  describe("unreadCounts", () => {
    it("runs all queries in a single transaction for snapshot consistency", () => {
      // Create messages for both agents
      agents.createMessage({ projectId, agentId, role: "agent", content: { text: "a1" } });
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "agent",
        content: { text: "b1" },
      });

      const counts = agents.unreadCounts(
        [agentId, agent2Id],
        new Map([
          [agentId, null],
          [agent2Id, null],
        ]),
      );

      // Both agents should have consistent counts from the same snapshot
      expect(counts.get(agentId)).toBe(1);
      expect(counts.get(agent2Id)).toBe(1);
    });

    it("returns 0 for agents with no messages", () => {
      const counts = agents.unreadCounts(
        [agentId, agent2Id],
        new Map([
          [agentId, null],
          [agent2Id, null],
        ]),
      );
      expect(counts.get(agentId)).toBe(0);
      expect(counts.get(agent2Id)).toBe(0);
    });

    it("counts only agent role messages", () => {
      // User message — should not count
      agents.createMessage({ projectId, agentId, role: "user", content: { text: "hello" } });
      // Tool use — should not count
      agents.createMessage({
        projectId,
        agentId,
        role: "tool_use",
        content: { tool: "read", tool_use_id: "t1" },
      });
      // Inter-agent — should not count
      agents.createMessage({
        projectId,
        agentId,
        role: "inter_agent",
        content: { text: "peer msg", from_agent: "other" },
      });
      // Agent message — should count
      agents.createMessage({ projectId, agentId, role: "agent", content: { text: "response" } });

      const counts = agents.unreadCounts([agentId], new Map([[agentId, null]]));
      expect(counts.get(agentId)).toBe(1);
    });

    it("returns 0 when last_read is at latest message", () => {
      const m1 = agents.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "first" },
      });
      const m2 = agents.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "second" },
      });

      // All read
      let counts = agents.unreadCounts([agentId], new Map([[agentId, m2.id]]));
      expect(counts.get(agentId)).toBe(0);

      // Only first read
      counts = agents.unreadCounts([agentId], new Map([[agentId, m1.id]]));
      expect(counts.get(agentId)).toBe(1);
    });
  });

  describe("latestAgentMessageId", () => {
    it("returns null when no messages exist", () => {
      expect(agents.latestAgentMessageId(agentId)).toBeNull();
    });

    it("returns the latest agent-role message id", () => {
      agents.createMessage({ projectId, agentId, role: "user", content: { text: "hello" } });
      const m1 = agents.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "first" },
      });
      expect(agents.latestAgentMessageId(agentId)).toBe(m1.id);

      const m2 = agents.createMessage({
        projectId,
        agentId,
        role: "agent",
        content: { text: "second" },
      });
      expect(agents.latestAgentMessageId(agentId)).toBe(m2.id);
    });
  });

  describe("latestUserMessageAt", () => {
    it("returns null when no user messages exist", () => {
      expect(agents.latestUserMessageAt(agentId)).toBeNull();
    });

    it("returns null when only non-user messages exist", () => {
      agents.createMessage({ projectId, agentId, role: "agent", content: { text: "response" } });
      agents.createMessage({
        projectId,
        agentId,
        role: "inter_agent",
        content: { text: "peer msg", from_agent: "other" },
      });
      expect(agents.latestUserMessageAt(agentId)).toBeNull();
    });

    it("returns the timestamp of the latest user message", () => {
      const m1 = agents.createMessage({
        projectId,
        agentId,
        role: "user",
        content: { text: "first" },
      });
      expect(agents.latestUserMessageAt(agentId)).toBe(m1.createdAt);

      const m2 = agents.createMessage({
        projectId,
        agentId,
        role: "user",
        content: { text: "second" },
      });
      expect(agents.latestUserMessageAt(agentId)).toBe(m2.createdAt);
    });

    it("ignores messages from other agents", () => {
      agents.createMessage({
        projectId,
        agentId: agent2Id,
        role: "user",
        content: { text: "hello" },
      });
      expect(agents.latestUserMessageAt(agentId)).toBeNull();
    });
  });

  describe("getMessage / updateMessage", () => {
    it("gets and updates a message", () => {
      const msg = agents.createMessage({
        projectId,
        agentId,
        role: "tool_use",
        content: { tool: "read", tool_use_id: "t1", output: null },
      });

      const fetched = agents.getMessage(msg.id);
      expect(fetched).toBeTruthy();
      expect((fetched!.content as Record<string, unknown>).tool).toBe("read");

      agents.updateMessage(msg.id, {
        content: { tool: "read", tool_use_id: "t1", output: "done" },
      });
      const updated = agents.getMessage(msg.id);
      expect((updated!.content as Record<string, unknown>).output).toBe("done");
    });
  });

  describe("updateAgent", () => {
    it("updates agent fields", () => {
      const updated = agents.updateAgent(agentId, {
        description: "Updated description",
        model: "claude-sonnet-4-6",
      });
      expect(updated).toBeDefined();
      expect(updated!.description).toBe("Updated description");
      expect(updated!.model).toBe("claude-sonnet-4-6");
    });

    it("updates name without affecting other fields", () => {
      agents.updateAgent(agentId, { description: "Keep me", model: "test-model" });
      const renamed = agents.updateAgent(agentId, { name: "renamed-agent" });
      expect(renamed!.name).toBe("renamed-agent");
      expect(renamed!.description).toBe("Keep me");
      expect(renamed!.model).toBe("test-model");
    });
  });

  describe("setSessionId", () => {
    it("sets sessionId on an agent", () => {
      agents.setSessionId(agentId, "session-abc-123");
      const agent = agents.getAgent(agentId);
      expect(agent!.sessionId).toBe("session-abc-123");
    });

    it("clears sessionId when set to null", () => {
      agents.setSessionId(agentId, "session-abc-123");
      agents.setSessionId(agentId, null);
      const agent = agents.getAgent(agentId);
      expect(agent!.sessionId).toBeNull();
    });
  });

  describe("createAgent with recipe fields", () => {
    it("stores recipe fields in DB", () => {
      const agent = agents.createAgent(projectId, {
        name: "recipe-agent",
        description: "A test agent",
        harness: "claude_code",
        model: "claude-sonnet-4-6",
      });
      expect(agent.description).toBe("A test agent");
      expect(agent.harness).toBe("claude_code");
      expect(agent.model).toBe("claude-sonnet-4-6");
    });
  });

  describe("emoji support", () => {
    it("stores emoji on creation", () => {
      const agent = agents.createAgent(projectId, {
        name: "emoji-agent",
        emoji: "\u{1F680}",
      });
      expect(agent.emoji).toBe("\u{1F680}");
    });

    it("defaults emoji to null when not provided", () => {
      const agent = agents.createAgent(projectId, { name: "no-emoji-agent" });
      expect(agent.emoji).toBeNull();
    });

    it("updates emoji via updateAgent", () => {
      const agent = agents.createAgent(projectId, { name: "update-emoji-agent" });
      const updated = agents.updateAgent(agent.id, { emoji: "\u{1F916}" });
      expect(updated!.emoji).toBe("\u{1F916}");
    });
  });

  describe("transaction support", () => {
    it("createMessage rolls back when transaction fails", () => {
      const initialMessages = agents.listMessages(projectId, agentId).messages.length;

      expect(() => {
        getDb().transaction((tx) => {
          agents.createMessage(
            { projectId, agentId, role: "user", content: { text: "will rollback" } },
            tx,
          );
          throw new Error("simulated failure");
        });
      }).toThrow("simulated failure");

      const afterMessages = agents.listMessages(projectId, agentId).messages.length;
      expect(afterMessages).toBe(initialMessages);
    });

    it("deleteAgent rolls back when transaction fails", () => {
      const tempAgent = agents.createAgent(projectId, { name: "temp-agent" });

      expect(() => {
        getDb().transaction((tx) => {
          agents.deleteAgent(tempAgent.id, tx);
          throw new Error("simulated failure");
        });
      }).toThrow("simulated failure");

      // Agent should still exist
      expect(agents.getAgent(tempAgent.id)).toBeDefined();
    });
  });

  describe("deleteAgent", () => {
    it("deletes agent and cascades messages", () => {
      const delAgent = agents.createAgent(projectId, { name: "delete-test" });
      agents.createMessage({
        projectId,
        agentId: delAgent.id,
        role: "user",
        content: { text: "hi" },
      });

      // Other agent's messages should survive
      const otherAgent = agents.createAgent(projectId, { name: "other-agent" });
      agents.createMessage({
        projectId,
        agentId: otherAgent.id,
        role: "user",
        content: { text: "keep me" },
      });

      agents.deleteAgent(delAgent.id);
      expect(agents.getAgent(delAgent.id)).toBeUndefined();

      const { messages: otherMsgs } = agents.listMessages(projectId, otherAgent.id);
      expect(otherMsgs.length).toBe(1);
    });
  });
});
