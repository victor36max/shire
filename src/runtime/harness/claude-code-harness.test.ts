import { describe, test, expect, mock } from "bun:test";
import { ClaudeCodeHarness } from "./claude-code-harness";
import type { AgentEvent, HarnessConfig } from "./types";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const baseConfig: HarnessConfig = {
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
};

/**
 * Augment an async generator with stub Query methods.
 * Casts are necessary here because we're building a mock of the SDK Query
 * interface, which is an AsyncGenerator + many methods with complex return types.
 */
function stubQueryMethods(gen: AsyncGenerator<SDKMessage, void, unknown>): Query {
  const q = gen as unknown as Query;
  q.interrupt = mock(() => Promise.resolve());
  q.close = mock(() => {});
  q.rewindFiles = mock(() =>
    Promise.resolve({ canRewind: false }),
  ) as unknown as Query["rewindFiles"];
  q.setPermissionMode = mock(() => Promise.resolve());
  q.setModel = mock(() => Promise.resolve());
  q.setMaxThinkingTokens = mock(() => Promise.resolve());
  q.initializationResult = mock(() =>
    Promise.resolve({}),
  ) as unknown as Query["initializationResult"];
  q.supportedCommands = mock(() => Promise.resolve([]));
  q.supportedModels = mock(() => Promise.resolve([]));
  q.supportedAgents = mock(() => Promise.resolve([]));
  q.mcpServerStatus = mock(() => Promise.resolve([]));
  q.accountInfo = mock(() => Promise.resolve({})) as unknown as Query["accountInfo"];
  q.reconnectMcpServer = mock(() => Promise.resolve());
  q.toggleMcpServer = mock(() => Promise.resolve());
  q.setMcpServers = mock(() => Promise.resolve({})) as unknown as Query["setMcpServers"];
  q.streamInput = mock(() => Promise.resolve());
  q.stopTask = mock(() => Promise.resolve());
  return q;
}

type QueryFn = ConstructorParameters<typeof ClaudeCodeHarness>[0];

function createMockQuery(messages: SDKMessage[]): NonNullable<QueryFn> {
  return mock(() => {
    const gen = (async function* () {
      for (const msg of messages) yield msg;
    })();
    return stubQueryMethods(gen);
  }) as unknown as NonNullable<QueryFn>;
}

function msg(obj: Record<string, unknown>): SDKMessage {
  return obj as unknown as SDKMessage;
}

function resultSuccess(result: string, sessionId: string): SDKMessage {
  return msg({
    type: "result",
    subtype: "success",
    result,
    session_id: sessionId,
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: false,
    num_turns: 1,
    stop_reason: "end_turn",
    total_cost_usd: 0.001,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000001",
  });
}

function resultError(errors: string[]): SDKMessage {
  return msg({
    type: "result",
    subtype: "error_during_execution",
    errors,
    session_id: "s-err",
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 10, output_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000002",
  });
}

function streamTextDelta(text: string): SDKMessage {
  return msg({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    uuid: "00000000-0000-0000-0000-000000000003",
    session_id: "s1",
  });
}

function streamToolUseStart(name: string): SDKMessage {
  return msg({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tool-1", name, input: "" },
    },
    parent_tool_use_id: null,
    uuid: "00000000-0000-0000-0000-000000000004",
    session_id: "s1",
  });
}

// Helper to access mock calls on the queryFn
function calls(queryFn: NonNullable<QueryFn>) {
  return (queryFn as unknown as ReturnType<typeof mock>).mock.calls as Array<
    [{ prompt: string; options?: Record<string, unknown> }]
  >;
}

describe("ClaudeCodeHarness", () => {
  test("getSessionId() returns null before any message", async () => {
    const harness = new ClaudeCodeHarness(createMockQuery([]));
    await harness.start(baseConfig);
    expect(harness.getSessionId()).toBeNull();
  });

  test("getSessionId() returns resume id after start", async () => {
    const harness = new ClaudeCodeHarness(createMockQuery([]));
    await harness.start({ ...baseConfig, resume: "sess-existing" });
    expect(harness.getSessionId()).toBe("sess-existing");
  });

  test("sendMessage() calls query with correct options", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const params = calls(mockQuery)[0][0];
    expect(params.prompt).toBe("Hello");
    expect(params.options?.model).toBe("claude-sonnet-4-6");
    expect(params.options?.systemPrompt).toBe("You are a helpful assistant.");
    expect(params.options?.cwd).toBe("/workspace");
  });

  test("sendMessage() passes resume id when config.resume is set", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "sess-123")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start({ ...baseConfig, resume: "sess-123" });
    await harness.sendMessage("Hello");

    expect(calls(mockQuery)[0][0].options?.resume).toBe("sess-123");
  });

  test("sendMessage() does not pass resume when no session id", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(calls(mockQuery)[0][0].options?.resume).toBeUndefined();
  });

  test("sendMessage() captures session_id from successful result", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "sess-new")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(harness.getSessionId()).toBe("sess-new");
  });

  test("sendMessage() emits session_id in turn_complete on success", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "sess-new")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc!.payload.session_id).toBe("sess-new");
  });

  test("sendMessage() does not emit session_id in turn_complete on error", async () => {
    const mockQuery = createMockQuery([resultError(["fail"])]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc!.payload.session_id).toBeUndefined();
  });

  test("sendMessage() uses new session_id for resume on subsequent calls", async () => {
    let callCount = 0;
    const mockQuery = mock(() => {
      const sid = callCount === 0 ? "sess-1" : "sess-1";
      const msgs = [resultSuccess(callCount === 0 ? "Hi" : "Bye", sid)];
      callCount++;
      const gen = (async function* () {
        for (const m of msgs) yield m;
      })();
      return stubQueryMethods(gen);
    }) as unknown as NonNullable<QueryFn>;

    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("First");
    await harness.sendMessage("Second");

    expect(calls(mockQuery)[1][0].options?.resume).toBe("sess-1");
  });

  test("clearSession() clears session id and prevents resume", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "sess-123")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start({ ...baseConfig, resume: "sess-123" });
    await harness.clearSession();

    expect(harness.getSessionId()).toBeNull();
    await harness.sendMessage("Fresh start");

    expect(calls(mockQuery)[0][0].options?.resume).toBeUndefined();
  });

  test("clearSession() only affects the immediately following sendMessage", async () => {
    let callCount = 0;
    const mockQuery = mock(() => {
      const msgs = [resultSuccess(callCount === 0 ? "Hi" : "Bye", "sess-new")];
      callCount++;
      const gen = (async function* () {
        for (const m of msgs) yield m;
      })();
      return stubQueryMethods(gen);
    }) as unknown as NonNullable<QueryFn>;

    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start({ ...baseConfig, resume: "sess-old" });
    await harness.clearSession();
    await harness.sendMessage("First after clear");
    await harness.sendMessage("Second after clear");

    expect(calls(mockQuery)[0][0].options?.resume).toBeUndefined();
    expect(calls(mockQuery)[1][0].options?.resume).toBe("sess-new");
  });

  test("sendMessage() emits text_delta from stream_event", async () => {
    const mockQuery = createMockQuery([
      streamTextDelta("Hello"),
      resultSuccess("Hello world", "s1"),
    ]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const delta = events.find((e) => e.type === "text_delta");
    expect(delta!.payload.delta).toBe("Hello");
  });

  test("sendMessage() emits text and turn_complete from result", async () => {
    const mockQuery = createMockQuery([resultSuccess("Full response", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
  });

  test("sendMessage() emits tool_use for tool content blocks", async () => {
    const mockQuery = createMockQuery([streamToolUseStart("bash"), resultSuccess("done", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("run ls");

    const toolEvent = events.find((e) => e.type === "tool_use");
    expect(toolEvent!.payload.tool).toBe("bash");
    expect(toolEvent!.payload.status).toBe("started");
  });

  test("sendMessage() emits error from result error", async () => {
    const mockQuery = createMockQuery([resultError(["something went wrong"])]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const errorEvent = events.find((e) => e.type === "error");
    expect(String(errorEvent!.payload.message)).toContain("something went wrong");
  });

  test("sendMessage() passes pathToClaudeCodeExecutable", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(calls(mockQuery)[0][0].options?.pathToClaudeCodeExecutable).toBe("claude");
  });

  test("sendMessage() prefixes from agent name", async () => {
    const mockQuery = createMockQuery([resultSuccess("Ok", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello", "agent-1");

    expect(calls(mockQuery)[0][0].prompt).toBe('[Message from agent "agent-1"]\nHello');
  });

  test("stop() suppresses further event emission", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.stop();
    await harness.sendMessage("should not emit");
    expect(events).toHaveLength(0);
  });

  test("sendMessage() emits turn_complete after exception in query iteration", async () => {
    const throwingQuery = mock(() => {
      const gen = (async function* () {
        throw new Error("SDK crash");
        yield resultSuccess("never", "s1");
      })();
      return stubQueryMethods(gen);
    }) as unknown as NonNullable<QueryFn>;

    const harness = new ClaudeCodeHarness(throwingQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const types = events.map((e) => e.type);
    expect(types).toContain("error");
    expect(types).toContain("turn_complete");
    // turn_complete should come after error
    const errorIdx = types.indexOf("error");
    const tcIdx = types.indexOf("turn_complete");
    expect(tcIdx).toBeGreaterThan(errorIdx);
  });

  test("interrupt() calls interrupt and close on active query", async () => {
    let resolveGenerator: (() => void) | null = null;
    const blockingQuery = mock(() => {
      const gen = (async function* () {
        await new Promise<void>((r) => {
          resolveGenerator = r;
        });
        yield resultSuccess("done", "s1");
      })();
      return stubQueryMethods(gen);
    }) as unknown as NonNullable<QueryFn>;

    const harness = new ClaudeCodeHarness(blockingQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    const sendPromise = harness.sendMessage("test");
    await new Promise((r) => setTimeout(r, 10));

    await harness.interrupt();
    const mockFn = blockingQuery as unknown as ReturnType<typeof mock>;
    const queryInstance = mockFn.mock.results[0].value as Query;
    expect(queryInstance.interrupt).toHaveBeenCalledTimes(1);
    expect(queryInstance.close).toHaveBeenCalledTimes(1);

    resolveGenerator!();
    await sendPromise;
  });
});
