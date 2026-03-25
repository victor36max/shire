import { describe, test, expect, mock } from "bun:test";
import { ClaudeCodeHarness } from "./claude-code-harness";
import type { AgentEvent, HarnessConfig } from "./types";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const baseConfig: HarnessConfig = {
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
  maxTokens: 4096,
};

/** Create a mock query function that yields the given SDK messages */
function createMockQuery(messages: SDKMessage[]) {
  return mock((_params: { prompt: string; options?: Record<string, unknown> }) => {
    const gen = (async function* () {
      for (const msg of messages) {
        yield msg;
      }
    })() as Query;

    gen.interrupt = mock(() => Promise.resolve());
    gen.close = mock(() => {});
    // Stub out other Query methods we don't use
    gen.rewindFiles = mock(() => Promise.resolve({ canRewind: false })) as Query["rewindFiles"];
    gen.setPermissionMode = mock(() => Promise.resolve());
    gen.setModel = mock(() => Promise.resolve());
    gen.setMaxThinkingTokens = mock(() => Promise.resolve());
    gen.initializationResult = mock(() => Promise.resolve({})) as Query["initializationResult"];
    gen.supportedCommands = mock(() => Promise.resolve([]));
    gen.supportedModels = mock(() => Promise.resolve([]));
    gen.supportedAgents = mock(() => Promise.resolve([]));
    gen.mcpServerStatus = mock(() => Promise.resolve([]));
    gen.accountInfo = mock(() => Promise.resolve({})) as Query["accountInfo"];
    gen.reconnectMcpServer = mock(() => Promise.resolve());
    gen.toggleMcpServer = mock(() => Promise.resolve());
    gen.setMcpServers = mock(() => Promise.resolve({})) as Query["setMcpServers"];
    gen.streamInput = mock(() => Promise.resolve());
    gen.stopTask = mock(() => Promise.resolve());

    return gen;
  });
}

function resultSuccess(result: string, sessionId: string): SDKMessage {
  return {
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
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "uuid-1",
  } as SDKMessage;
}

function resultError(errors: string[], sessionId: string): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    errors,
    session_id: sessionId,
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.001,
    usage: {
      input_tokens: 10,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "uuid-err",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function streamTextDelta(text: string, sessionId: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    parent_tool_use_id: null,
    uuid: "uuid-stream-1",
    session_id: sessionId,
  } as SDKMessage;
}

function streamToolUseStart(name: string, sessionId: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tool-1", name, input: "" },
    },
    parent_tool_use_id: null,
    uuid: "uuid-stream-2",
    session_id: sessionId,
  } as SDKMessage;
}

describe("ClaudeCodeHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new ClaudeCodeHarness(createMockQuery([]));
    expect(harness.isProcessing()).toBe(false);
  });

  test("start() is a no-op that does not throw", async () => {
    const harness = new ClaudeCodeHarness(createMockQuery([]));
    await harness.start(baseConfig);
  });

  test("sendMessage() calls query with correct options", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const params = mockQuery.mock.calls[0][0];
    expect(params.prompt).toBe("Hello");
    expect(params.options?.model).toBe("claude-sonnet-4-6");
    expect(params.options?.systemPrompt).toBe("You are a helpful assistant.");
    expect(params.options?.cwd).toBe("/workspace");
    expect(params.options?.permissionMode).toBe("bypassPermissions");
  });

  test("sendMessage() composes internalSystemPrompt with systemPrompt", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start({
      ...baseConfig,
      internalSystemPrompt: "# Internal\nYou are agent-1.",
    });
    await harness.sendMessage("Hello");

    const params = mockQuery.mock.calls[0][0];
    expect(params.options?.systemPrompt).toBe("# Internal\nYou are agent-1.\n\nYou are a helpful assistant.");
  });

  test("sendMessage() uses only systemPrompt when internalSystemPrompt is absent", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const params = mockQuery.mock.calls[0][0];
    expect(params.options?.systemPrompt).toBe("You are a helpful assistant.");
  });

  test("sendMessage() passes continue: true in query options", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "sess-123")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("First message");

    const params = mockQuery.mock.calls[0][0];
    expect(params.options?.continue).toBe(true);
    expect(params.options?.resume).toBeUndefined();
  });

  test("sendMessage() emits text_delta from stream_event", async () => {
    const mockQuery = createMockQuery([streamTextDelta("Hello", "s1"), resultSuccess("Hello world", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const delta = events.find((e) => e.type === "text_delta");
    expect(delta).toBeDefined();
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

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent!.payload.text).toBe("Full response");
  });

  test("sendMessage() emits tool_use for tool content blocks", async () => {
    const mockQuery = createMockQuery([streamToolUseStart("bash", "s1"), resultSuccess("done", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("run ls");

    const toolEvent = events.find((e) => e.type === "tool_use");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.payload.tool).toBe("bash");
    expect(toolEvent!.payload.tool_use_id).toBe("tool-1");
    expect(toolEvent!.payload.input).toEqual({});
    expect(toolEvent!.payload.status).toBe("started");
  });

  test("sendMessage() emits error from result error", async () => {
    const mockQuery = createMockQuery([resultError(["something went wrong"], "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("something went wrong");
  });

  test("interrupt() calls interrupt and close on active query", async () => {
    let resolveGenerator: (() => void) | null = null;
    const blockingQuery = mock(() => {
      const gen = (async function* () {
        await new Promise<void>((r) => {
          resolveGenerator = r;
        });
        yield resultSuccess("done", "s1");
      })() as Query;

      gen.interrupt = mock(() => Promise.resolve());
      gen.close = mock(() => {});
      gen.rewindFiles = mock(() => Promise.resolve({ canRewind: false })) as Query["rewindFiles"];
      gen.setPermissionMode = mock(() => Promise.resolve());
      gen.setModel = mock(() => Promise.resolve());
      gen.setMaxThinkingTokens = mock(() => Promise.resolve());
      gen.initializationResult = mock(() => Promise.resolve({})) as Query["initializationResult"];
      gen.supportedCommands = mock(() => Promise.resolve([]));
      gen.supportedModels = mock(() => Promise.resolve([]));
      gen.supportedAgents = mock(() => Promise.resolve([]));
      gen.mcpServerStatus = mock(() => Promise.resolve([]));
      gen.accountInfo = mock(() => Promise.resolve({})) as Query["accountInfo"];
      gen.reconnectMcpServer = mock(() => Promise.resolve());
      gen.toggleMcpServer = mock(() => Promise.resolve());
      gen.setMcpServers = mock(() => Promise.resolve({})) as Query["setMcpServers"];
      gen.streamInput = mock(() => Promise.resolve());
      gen.stopTask = mock(() => Promise.resolve());

      return gen;
    });

    const harness = new ClaudeCodeHarness(blockingQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);

    const sendPromise = harness.sendMessage("test");
    // Wait for the generator to be created
    await new Promise((r) => setTimeout(r, 10));

    await harness.interrupt();

    const queryInstance = blockingQuery.mock.results[0].value as Query;
    expect(queryInstance.interrupt).toHaveBeenCalledTimes(1);
    expect(queryInstance.close).toHaveBeenCalledTimes(1);

    resolveGenerator!();
    await sendPromise;
  });

  test("isProcessing() tracks query lifecycle", async () => {
    let resolveGenerator: (() => void) | null = null;
    const blockingQuery = mock(() => {
      const gen = (async function* () {
        await new Promise<void>((r) => {
          resolveGenerator = r;
        });
        yield resultSuccess("done", "s1");
      })() as Query;

      gen.interrupt = mock(() => Promise.resolve());
      gen.close = mock(() => {});
      gen.rewindFiles = mock(() => Promise.resolve({ canRewind: false })) as Query["rewindFiles"];
      gen.setPermissionMode = mock(() => Promise.resolve());
      gen.setModel = mock(() => Promise.resolve());
      gen.setMaxThinkingTokens = mock(() => Promise.resolve());
      gen.initializationResult = mock(() => Promise.resolve({})) as Query["initializationResult"];
      gen.supportedCommands = mock(() => Promise.resolve([]));
      gen.supportedModels = mock(() => Promise.resolve([]));
      gen.supportedAgents = mock(() => Promise.resolve([]));
      gen.mcpServerStatus = mock(() => Promise.resolve([]));
      gen.accountInfo = mock(() => Promise.resolve({})) as Query["accountInfo"];
      gen.reconnectMcpServer = mock(() => Promise.resolve());
      gen.toggleMcpServer = mock(() => Promise.resolve());
      gen.setMcpServers = mock(() => Promise.resolve({})) as Query["setMcpServers"];
      gen.streamInput = mock(() => Promise.resolve());
      gen.stopTask = mock(() => Promise.resolve());

      return gen;
    });

    const harness = new ClaudeCodeHarness(blockingQuery);
    harness.onEvent(() => {});
    await harness.start(baseConfig);

    const sendPromise = harness.sendMessage("test");
    // Processing should be true while query is running
    expect(harness.isProcessing()).toBe(true);

    resolveGenerator!();
    await sendPromise;
    expect(harness.isProcessing()).toBe(false);
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

  test("sendMessage() emits tool_use input_ready from assistant message", async () => {
    const assistantMsg: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id: "tu-abc", name: "Bash", input: { command: "echo hello" } }],
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      parent_tool_use_id: null,
      uuid: "uuid-asst-1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const mockQuery = createMockQuery([assistantMsg, resultSuccess("done", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("run echo");

    const toolEvent = events.find((e) => e.type === "tool_use" && e.payload.status === "input_ready");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.payload.tool).toBe("Bash");
    expect(toolEvent!.payload.tool_use_id).toBe("tu-abc");
    expect(toolEvent!.payload.input).toEqual({ command: "echo hello" });
  });

  test("sendMessage() emits tool_result from user message", async () => {
    const userMsg: SDKMessage = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-abc",
            content: [{ type: "text", text: "hello world" }],
            is_error: false,
          },
        ],
      },
      parent_tool_use_id: null,
      isSynthetic: true,
      session_id: "s1",
    } as unknown as SDKMessage;

    const mockQuery = createMockQuery([userMsg, resultSuccess("done", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.payload.tool_use_id).toBe("tu-abc");
    expect(resultEvent!.payload.output).toBe("hello world");
    expect(resultEvent!.payload.is_error).toBe(false);
  });

  test("sendMessage() prefixes from agent name", async () => {
    const mockQuery = createMockQuery([resultSuccess("Ok", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("Hello", "agent-1");

    const params = mockQuery.mock.calls[0][0];
    expect(params.prompt).toBe('[Message from agent "agent-1"]\nHello');
  });

  test("sendMessage() includes Skill in allowedTools and project settingSources", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const params = mockQuery.mock.calls[0][0];
    expect(params.options?.allowedTools).toContain("Skill");
    expect(params.options?.settingSources).toEqual(["project"]);
  });

  test("clearSession() causes next sendMessage to skip continue", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.clearSession();
    await harness.sendMessage("Fresh start");

    const params = mockQuery.mock.calls[0][0];
    expect(params.options?.continue).toBe(false);
  });

  test("clearSession() only affects the immediately following sendMessage", async () => {
    const mockQuery = createMockQuery([resultSuccess("Hi", "s1")]);
    const harness = new ClaudeCodeHarness(mockQuery);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.clearSession();
    await harness.sendMessage("First after clear");
    await harness.sendMessage("Second after clear");

    expect(mockQuery.mock.calls[0][0].options?.continue).toBe(false);
    expect(mockQuery.mock.calls[1][0].options?.continue).toBe(true);
  });
});
