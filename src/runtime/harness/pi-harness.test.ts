import { describe, test, expect, mock } from "bun:test";
import { PiHarness } from "./pi-harness";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "anthropic/claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
};

function createMockSession(sessionId = "pi-sess-1") {
  let subscriber: ((event: AgentSessionEvent) => void) | null = null;
  const session = {
    get sessionId() {
      return sessionId;
    },
    subscribe: mock((cb: (event: AgentSessionEvent) => void) => {
      subscriber = cb;
      return () => {};
    }),
    prompt: mock(async (_text: string) => {
      if (subscriber) {
        subscriber({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello" },
        } as AgentSessionEvent);
        subscriber({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
        } as AgentSessionEvent);
        subscriber({ type: "agent_end" } as AgentSessionEvent);
      }
    }),
    abort: mock(async () => {}),
    fireEvent: (event: AgentSessionEvent) => {
      if (subscriber) subscriber(event);
    },
  };
  return session as typeof session & AgentSession;
}

describe("PiHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new PiHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("getSessionId() returns null before any message", async () => {
    const harness = new PiHarness();
    await harness.start(baseConfig);
    expect(harness.getSessionId()).toBeNull();
  });

  test("getSessionId() returns session id after sendMessage", async () => {
    const harness = new PiHarness();
    harness.onEvent(() => {});
    harness._setSessionFactory(async () => createMockSession("pi-sess-42"));
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    expect(harness.getSessionId()).toBe("pi-sess-42");
  });

  test("start() does not create session eagerly", async () => {
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

  test("sendMessage() maps text_delta events", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

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
  });

  test("turn_complete includes session_id", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession("pi-sess-99"));
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc).toBeDefined();
    expect(tc!.payload.session_id).toBe("pi-sess-99");
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
    expect(toolStart[0].payload.tool).toBe("bash");

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0].payload.tool_use_id).toBe("tc1");
  });

  test("sendMessage() prepends agent prefix", async () => {
    const harness = new PiHarness();
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("Some data", "researcher-bot");
    expect(mockSession.prompt).toHaveBeenCalledWith(
      '[Message from agent "researcher-bot"]\nSome data',
    );
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
    expect(events.map((e) => e.type)).toContain("turn_complete");
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
    await harness.sendMessage("init");
    await harness.interrupt();
    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });

  test("clearSession() causes a new session on next sendMessage()", async () => {
    const factory = mock(async () => createMockSession());
    const harness = new PiHarness();
    harness.onEvent(() => {});
    harness._setSessionFactory(factory);
    await harness.start(baseConfig);
    await harness.sendMessage("First");
    expect(factory).toHaveBeenCalledTimes(1);

    await harness.clearSession();
    expect(harness.getSessionId()).toBeNull();
    await harness.sendMessage("Fresh start");
    expect(factory).toHaveBeenCalledTimes(2);
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

  test("sendMessage() after stop() throws", async () => {
    const harness = new PiHarness();
    harness._setSessionFactory(async () => createMockSession());
    await harness.start(baseConfig);
    await harness.stop();
    await expect(harness.sendMessage("too late")).rejects.toThrow("Harness is stopped");
  });

  test("isProcessing() returns false initially", () => {
    const harness = new PiHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("interrupt() does nothing when session is null", async () => {
    const harness = new PiHarness();
    await harness.start(baseConfig);
    // Should not throw
    await harness.interrupt();
  });

  test("message_end with non-assistant role is ignored", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "user text" }] },
      } as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);
  });

  test("message_end with string content produces text event", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "message_end",
        message: { role: "assistant", content: "Simple string response" },
      } as unknown as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].payload.text).toBe("Simple string response");
  });

  test("tool_execution_end with object result serializes to JSON", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "tc-json",
        args: {},
      } as AgentSessionEvent);
      mockSession.fireEvent({
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "tc-json",
        result: { content: [{ type: "text", text: "file data" }] },
        isError: false,
      } as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    // Non-string result should be JSON.stringified
    expect(resultEvents[0].payload.output).toContain("file data");
  });

  test("message_end with empty content array produces empty text", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "message_end",
        message: { role: "assistant", content: [] },
      } as unknown as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].payload.text).toBe("");
  });

  test("message_end with non-text content blocks produces empty text", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
        },
      } as unknown as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].payload.text).toBe("");
  });

  test("tool_execution_end with string result passes directly", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "tc-str",
      } as AgentSessionEvent);
      mockSession.fireEvent({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "tc-str",
        result: "direct string output",
        isError: true,
      } as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    expect(resultEvents[0].payload.output).toBe("direct string output");
    expect(resultEvents[0].payload.is_error).toBe(true);
  });

  test("message_end with array of text content blocks joins text", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "World" },
          ],
        },
      } as unknown as AgentSessionEvent);
      mockSession.fireEvent({ type: "agent_end" } as AgentSessionEvent);
    });
    harness._setSessionFactory(async () => mockSession);
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].payload.text).toBe("Hello World");
  });
});
