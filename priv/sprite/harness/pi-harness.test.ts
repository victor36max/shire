import { describe, test, expect, mock } from "bun:test";
import { PiHarness, type SessionLike } from "./pi-harness";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "anthropic/claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
  maxTokens: 4096,
};

function createMockSession() {
  let subscriber: ((event: AgentSessionEvent) => void) | null = null;
  const session: SessionLike & { fireEvent: (event: AgentSessionEvent) => void } = {
    subscribe: mock((cb: (event: AgentSessionEvent) => void) => {
      subscriber = cb;
    }),
    prompt: mock(async (_text: string) => {
      if (subscriber) {
        subscriber({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello" },
        } as AgentSessionEvent);
        subscriber({
          type: "message_end",
          message: { content: [{ type: "text", text: "Hello world" }] },
        } as AgentSessionEvent);
        subscriber({ type: "agent_end" } as AgentSessionEvent);
      }
    }),
    abort: mock(async () => {}),
    fireEvent: (event: AgentSessionEvent) => {
      if (subscriber) subscriber(event);
    },
  };
  return session;
}

describe("PiHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new PiHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("start() initializes without throwing", async () => {
    const harness = new PiHarness();
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
  });

  test("sendMessage() maps text_delta events correctly", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
    await harness.sendMessage("Hi there");
    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].payload.delta).toBe("Hello");
  });

  test("sendMessage() emits text and turn_complete events", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent?.payload.text).toBe("Hello world");
  });

  test("sendMessage() maps tool events", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "tc1",
      } as AgentSessionEvent);
      mockSession.fireEvent({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "tc1",
        result: { content: [{ type: "text", text: "done" }] },
      } as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("run ls");
    const toolEvents = events.filter((e) => e.type === "tool_use");
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].payload.status).toBe("started");
    expect(toolEvents[0].payload.tool).toBe("bash");
    expect(toolEvents[1].payload.status).toBe("completed");
  });

  test("sendMessage() prepends agent prefix for agent messages", async () => {
    const harness = new PiHarness();
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("Some data", "researcher-bot");
    expect(mockSession.prompt).toHaveBeenCalledWith('[Message from agent "researcher-bot"]\nSome data');
  });

  test("isProcessing() returns true during sendMessage()", async () => {
    const harness = new PiHarness();
    let processingDuringCall = false;
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      processingDuringCall = harness.isProcessing();
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");
    expect(processingDuringCall).toBe(true);
    expect(harness.isProcessing()).toBe(false);
  });

  test("sendMessage() emits error event on SDK failure", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      throw new Error("Rate limit exceeded");
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("Rate limit exceeded");
  });

  test("stop() suppresses further event emission", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.stop();
    mockSession.fireEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "should not appear" },
    } as AgentSessionEvent);
    expect(events).toHaveLength(0);
  });

  test("interrupt() calls abort on the session", async () => {
    const harness = new PiHarness();
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.interrupt();
    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });
});
