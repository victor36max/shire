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

  test("start() initializes without throwing and does not create session", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    expect(factory).not.toHaveBeenCalled();
  });

  test("session is created lazily on first sendMessage()", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness.onEvent(() => {});
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    expect(factory).not.toHaveBeenCalled();
    await harness.sendMessage("Hi");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("session is reused across multiple sendMessage() calls", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness.onEvent(() => {});
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    await harness.sendMessage("Again");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("sendMessage() throws if start() was not called", async () => {
    const harness = new PiHarness();
    harness._setSessionFactory(async () => createMockSession());
    await expect(harness.sendMessage("Hi")).rejects.toThrow("Harness not started");
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
    const toolStart = events.filter((e) => e.type === "tool_use");
    expect(toolStart).toHaveLength(1);
    expect(toolStart[0].payload.status).toBe("started");
    expect(toolStart[0].payload.tool).toBe("bash");
    expect(toolStart[0].payload.tool_use_id).toBe("tc1");
    expect(toolStart[0].payload.input).toEqual({});

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0].payload.tool_use_id).toBe("tc1");
    expect(toolResult[0].payload.is_error).toBe(false);
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

  test("sendMessage() emits error and turn_complete on SDK failure", async () => {
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
    const types = events.map((e) => e.type);
    expect(types).toContain("turn_complete");
    // turn_complete should come after error
    const errorIdx = types.indexOf("error");
    const turnIdx = types.indexOf("turn_complete");
    expect(turnIdx).toBeGreaterThan(errorIdx);
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
    harness.onEvent(() => {});
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    // Create session by sending a message first
    await harness.sendMessage("init");
    await harness.interrupt();
    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });

  test("interrupt() is a no-op before session is created", async () => {
    const harness = new PiHarness();
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
    // Should not throw even though no session exists yet
    await harness.interrupt();
  });

  test("concurrent sendMessage() calls only create one session", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness.onEvent(() => {});
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    await Promise.all([harness.sendMessage("A"), harness.sendMessage("B")]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("sendMessage() after stop() does not create a new session", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    await harness.stop();
    await expect(harness.sendMessage("too late")).rejects.toThrow("Harness is stopped");
    expect(factory).not.toHaveBeenCalled();
  });
});
