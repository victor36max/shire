import { describe, it, expect, beforeEach } from "bun:test";
import { useTestDb } from "../test/setup";
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
    const agent = agents.createAgent(projectId, "test-agent");
    agentId = agent.id;
    const agent2 = agents.createAgent(projectId, "chat-agent");
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

  describe("deleteAgent", () => {
    it("deletes agent and cascades messages", () => {
      const delAgent = agents.createAgent(projectId, "delete-test");
      agents.createMessage({
        projectId,
        agentId: delAgent.id,
        role: "user",
        content: { text: "hi" },
      });

      // Other agent's messages should survive
      const otherAgent = agents.createAgent(projectId, "other-agent");
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
