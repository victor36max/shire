import { describe, test, expect, mock } from "bun:test";
import { CodexHarness } from "./codex-harness";
import type { AgentEvent, HarnessConfig } from "./types";
import type { Codex, ThreadEvent, ThreadOptions } from "@openai/codex-sdk";

const baseConfig: HarnessConfig = {
  model: "o4-mini",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a mock Thread whose runStreamed yields the given events. */
function createMockThread(eventsByTurn: ThreadEvent[][]) {
  let turnIndex = 0;
  const runStreamed = mock(async (_input: unknown, _opts?: unknown) => {
    const events = eventsByTurn[turnIndex] ?? [];
    turnIndex++;
    return {
      events: (async function* () {
        for (const e of events) yield e;
      })(),
    };
  });
  return {
    runStreamed,
    get id() {
      return "thread-abc";
    },
  };
}

type MockThread = ReturnType<typeof createMockThread>;

/** Build a mock Codex whose startThread / resumeThread return the given thread. */
function createMockCodex(thread: MockThread) {
  const startThread = mock((_opts?: ThreadOptions) => thread);
  const resumeThread = mock((_id: string, _opts?: ThreadOptions) => thread);
  return { startThread, resumeThread };
}

type MockCodex = ReturnType<typeof createMockCodex>;

type CodexFactory = ConstructorParameters<typeof CodexHarness>[0];

function factory(codex: MockCodex): NonNullable<CodexFactory> {
  return () => codex as unknown as Codex;
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function threadStarted(id = "thread-abc"): ThreadEvent {
  return { type: "thread.started", thread_id: id };
}

function turnStarted(): ThreadEvent {
  return { type: "turn.started" };
}

function turnCompleted(tokens = 100): ThreadEvent {
  return {
    type: "turn.completed",
    usage: { input_tokens: tokens, cached_input_tokens: 0, output_tokens: tokens },
  };
}

function turnFailed(message = "something went wrong"): ThreadEvent {
  return { type: "turn.failed", error: { message } };
}

function agentMessage(text: string, id = "msg-1"): ThreadEvent {
  return { type: "item.completed", item: { id, type: "agent_message", text } };
}

function commandStarted(command: string, id = "cmd-1"): ThreadEvent {
  return {
    type: "item.started",
    item: {
      id,
      type: "command_execution",
      command,
      aggregated_output: "",
      status: "in_progress",
    },
  };
}

function commandCompleted(
  command: string,
  output: string,
  exitCode = 0,
  id = "cmd-1",
): ThreadEvent {
  return {
    type: "item.completed",
    item: {
      id,
      type: "command_execution",
      command,
      aggregated_output: output,
      exit_code: exitCode,
      status: exitCode === 0 ? "completed" : "failed",
    },
  };
}

function fileChangeStarted(id = "fc-1"): ThreadEvent {
  return {
    type: "item.started",
    item: { id, type: "file_change", changes: [], status: "completed" },
  };
}

function fileChangeCompleted(
  changes: Array<{ path: string; kind: "add" | "delete" | "update" }>,
  id = "fc-1",
): ThreadEvent {
  return {
    type: "item.completed",
    item: { id, type: "file_change", changes, status: "completed" },
  };
}

function mcpToolStarted(server: string, tool: string, id = "mcp-1"): ThreadEvent {
  return {
    type: "item.started",
    item: {
      id,
      type: "mcp_tool_call",
      server,
      tool,
      arguments: {},
      status: "in_progress",
    },
  };
}

function mcpToolCompleted(server: string, tool: string, result: string, id = "mcp-1"): ThreadEvent {
  return {
    type: "item.completed",
    item: {
      id,
      type: "mcp_tool_call",
      server,
      tool,
      arguments: {},
      result: {
        content: [{ type: "text", text: result }],
        structured_content: null,
      },
      status: "completed",
    },
  };
}

function errorItem(message: string, id = "err-1"): ThreadEvent {
  return { type: "item.completed", item: { id, type: "error", message } };
}

function streamError(message: string): ThreadEvent {
  return { type: "error", message };
}

/** A basic successful turn: thread started, turn started, agent message, turn completed. */
function basicTurnEvents(text = "Hello", threadId = "thread-abc"): ThreadEvent[] {
  return [threadStarted(threadId), turnStarted(), agentMessage(text), turnCompleted()];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodexHarness", () => {
  // -- Lifecycle --

  test("getSessionId() returns null before any message", async () => {
    const thread = createMockThread([]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    await harness.start(baseConfig);
    expect(harness.getSessionId()).toBeNull();
  });

  test("getSessionId() returns resume id after start", async () => {
    const thread = createMockThread([]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    await harness.start({ ...baseConfig, resume: "thread-existing" });
    expect(harness.getSessionId()).toBe("thread-existing");
  });

  test("isProcessing() returns false initially", () => {
    const thread = createMockThread([]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    expect(harness.isProcessing()).toBe(false);
  });

  // -- sendMessage basics --

  test("sendMessage() creates thread with correct options", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(codex.startThread).toHaveBeenCalledTimes(1);
    const opts = (codex.startThread as ReturnType<typeof mock>).mock.calls[0][0] as ThreadOptions;
    expect(opts.model).toBe("o4-mini");
    expect(opts.workingDirectory).toBe("/workspace");
    expect(opts.sandboxMode).toBe("danger-full-access");
    expect(opts.skipGitRepoCheck).toBe(true);
  });

  test("sendMessage() passes prompt text to runStreamed", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    const call = (thread.runStreamed as ReturnType<typeof mock>).mock.calls[0];
    const prompt = call[0] as string;
    expect(prompt).toContain("Hello");
  });

  test("sendMessage() prefixes from agent name", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("Hello", "agent-1");

    const call = (thread.runStreamed as ReturnType<typeof mock>).mock.calls[0];
    const prompt = call[0] as string;
    expect(prompt).toContain('[Message from agent "agent-1"]');
    expect(prompt).toContain("Hello");
  });

  // -- Text events --

  test("sendMessage() emits text_delta for agent_message items", async () => {
    const thread = createMockThread([basicTurnEvents("Hello world")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const delta = events.find((e) => e.type === "text_delta");
    expect(delta).toBeDefined();
    expect(delta!.payload.delta).toBe("Hello world");
  });

  test("sendMessage() emits text and turn_complete on turn.completed", async () => {
    const thread = createMockThread([basicTurnEvents("Full response")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
  });

  test("sendMessage() captures thread_id as session_id in turn_complete", async () => {
    const thread = createMockThread([basicTurnEvents("Hi")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc!.payload.session_id).toBe("thread-abc");
  });

  test("getSessionId() returns thread_id after sendMessage", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    expect(harness.getSessionId()).toBe("thread-abc");
  });

  // -- Tool events --

  test("sendMessage() emits tool_use started for command_execution", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      commandStarted("ls -la"),
      commandCompleted("ls -la", "file1\nfile2"),
      agentMessage("Listed files"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("run ls");

    const toolStart = events.find((e) => e.type === "tool_use" && e.payload.status === "started");
    expect(toolStart).toBeDefined();
    expect(toolStart!.type).toBe("tool_use");
    if (toolStart!.type === "tool_use") {
      expect(toolStart!.payload.tool).toBe("command_execution");
      expect(toolStart!.payload.tool_use_id).toBe("cmd-1");
    }
  });

  test("sendMessage() emits tool_result for completed command_execution", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      commandStarted("echo hello"),
      commandCompleted("echo hello", "hello\n", 0),
      agentMessage("Done"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const result = events.find((e) => e.type === "tool_result");
    expect(result).toBeDefined();
    expect(result!.payload.tool_use_id).toBe("cmd-1");
    expect(result!.payload.output).toBe("hello\n");
    expect(result!.payload.is_error).toBe(false);
  });

  test("sendMessage() marks failed command as is_error", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      commandStarted("bad-cmd"),
      commandCompleted("bad-cmd", "not found", 127),
      agentMessage("Command failed"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const result = events.find((e) => e.type === "tool_result");
    expect(result!.payload.is_error).toBe(true);
  });

  test("sendMessage() emits tool_use for mcp_tool_call", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      mcpToolStarted("fs", "readFile"),
      mcpToolCompleted("fs", "readFile", "file contents"),
      agentMessage("Read the file"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const toolStart = events.find((e) => e.type === "tool_use" && e.payload.status === "started");
    expect(toolStart!.type).toBe("tool_use");
    if (toolStart!.type === "tool_use") {
      expect(toolStart!.payload.tool).toBe("readFile");
      expect(toolStart!.payload.tool_use_id).toBe("mcp-1");
    }
  });

  test("sendMessage() emits tool_result for completed mcp_tool_call", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      mcpToolStarted("fs", "readFile"),
      mcpToolCompleted("fs", "readFile", "file contents"),
      agentMessage("Done"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const result = events.find((e) => e.type === "tool_result");
    expect(result!.payload.output).toBe("file contents");
    expect(result!.payload.is_error).toBe(false);
  });

  test("sendMessage() emits tool_use and tool_result for file_change", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      fileChangeStarted(),
      fileChangeCompleted([{ path: "src/index.ts", kind: "update" }]),
      agentMessage("Updated file"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const toolStart = events.find((e) => e.type === "tool_use" && e.payload.status === "started");
    expect(toolStart).toBeDefined();
    if (toolStart!.type === "tool_use") {
      expect(toolStart!.payload.tool).toBe("file_change");
      expect(toolStart!.payload.tool_use_id).toBe("fc-1");
    }
    const result = events.find((e) => e.type === "tool_result");
    expect(result!.payload.tool_use_id).toBe("fc-1");
    expect(result!.payload.output).toContain("src/index.ts");
  });

  // -- Error events --

  test("sendMessage() emits error from turn.failed", async () => {
    const evts: ThreadEvent[] = [threadStarted(), turnStarted(), turnFailed("API error")];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const err = events.find((e) => e.type === "error");
    expect(err!.payload.message).toContain("API error");
    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc).toBeDefined();
  });

  test("sendMessage() emits error and turn_complete from stream error event", async () => {
    const evts: ThreadEvent[] = [threadStarted(), streamError("connection lost")];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const err = events.find((e) => e.type === "error");
    expect(err!.payload.message).toContain("connection lost");
    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc).toBeDefined();
  });

  test("sendMessage() emits error and turn_complete on thrown exception", async () => {
    const thread = createMockThread([]);
    // Override runStreamed to throw
    thread.runStreamed = mock(async () => {
      throw new Error("SDK crash");
    });
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const types = events.map((e) => e.type);
    expect(types).toContain("error");
    expect(types).toContain("turn_complete");
    const errorIdx = types.indexOf("error");
    const tcIdx = types.indexOf("turn_complete");
    expect(tcIdx).toBeGreaterThan(errorIdx);
  });

  test("sendMessage() emits error item as AgentEvent error", async () => {
    const evts: ThreadEvent[] = [
      threadStarted(),
      turnStarted(),
      errorItem("rate limit exceeded"),
      turnCompleted(),
    ];
    const thread = createMockThread([evts]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const err = events.find((e) => e.type === "error");
    expect(err!.payload.message).toBe("rate limit exceeded");
  });

  // -- Session management --

  test("thread is reused across multiple sendMessage calls", async () => {
    const thread = createMockThread([basicTurnEvents("First"), basicTurnEvents("Second")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    await harness.sendMessage("First");
    await harness.sendMessage("Second");

    expect(codex.startThread).toHaveBeenCalledTimes(1);
    expect(thread.runStreamed).toHaveBeenCalledTimes(2);
  });

  test("resume uses resumeThread with threadId", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start({ ...baseConfig, resume: "thread-old" });
    await harness.sendMessage("Continue");

    expect(codex.resumeThread).toHaveBeenCalledTimes(1);
    expect(codex.startThread).not.toHaveBeenCalled();
    const args = (codex.resumeThread as ReturnType<typeof mock>).mock.calls[0];
    expect(args[0]).toBe("thread-old");
  });

  test("clearSession() causes a new thread on next sendMessage", async () => {
    const thread = createMockThread([basicTurnEvents("First"), basicTurnEvents("Fresh")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start({ ...baseConfig, resume: "thread-old" });
    await harness.sendMessage("First");
    await harness.clearSession();

    expect(harness.getSessionId()).toBeNull();

    await harness.sendMessage("Fresh start");
    // Should have called startThread (not resumeThread) for the second message
    expect(codex.startThread).toHaveBeenCalledTimes(1);
  });

  // -- Stop --

  test("stop() suppresses further event emission", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    await harness.start(baseConfig);
    await harness.stop();
    await harness.sendMessage("should not emit");
    expect(events).toHaveLength(0);
  });

  // -- Interrupt --

  test("interrupt() aborts the active turn via AbortController", async () => {
    const blocker: { resolve: (() => void) | null } = { resolve: null };
    const thread = createMockThread([]);
    const _originalRunStreamed = thread.runStreamed;
    thread.runStreamed = mock(async (_input: unknown, _opts?: unknown) => {
      const opts = _opts as { signal?: AbortSignal } | undefined;
      const signal = opts?.signal;
      return {
        events: (async function* () {
          yield threadStarted();
          yield turnStarted();
          // Block until resolved or aborted
          await new Promise<void>((resolve) => {
            blocker.resolve = resolve;
            signal?.addEventListener("abort", () => resolve());
          });
          yield turnCompleted();
        })(),
      };
    }) as typeof _originalRunStreamed;
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start(baseConfig);
    const sendPromise = harness.sendMessage("test");

    // Give the async generator time to start
    await new Promise((r) => setTimeout(r, 10));

    await harness.interrupt();

    // Unblock and await completion
    blocker.resolve?.();
    await sendPromise;

    expect(harness.isProcessing()).toBe(false);
  });

  // -- System prompt --

  test("sendMessage() prepends system prompt to first message", async () => {
    const thread = createMockThread([basicTurnEvents()]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start({
      ...baseConfig,
      systemPrompt: "You are a helper.",
      internalSystemPrompt: "Internal instructions here.",
    });
    await harness.sendMessage("Hello");

    const call = (thread.runStreamed as ReturnType<typeof mock>).mock.calls[0];
    const prompt = call[0] as string;
    expect(prompt).toContain("Internal instructions here.");
    expect(prompt).toContain("You are a helper.");
    expect(prompt).toContain("Hello");
  });

  test("sendMessage() does not prepend system prompt on subsequent messages", async () => {
    const thread = createMockThread([basicTurnEvents("First"), basicTurnEvents("Second")]);
    const codex = createMockCodex(thread);
    const harness = new CodexHarness(factory(codex));
    harness.onEvent(() => {});
    await harness.start({
      ...baseConfig,
      systemPrompt: "You are a helper.",
    });
    await harness.sendMessage("First");
    await harness.sendMessage("Second");

    const secondCall = (thread.runStreamed as ReturnType<typeof mock>).mock.calls[1];
    const prompt = secondCall[0] as string;
    expect(prompt).toBe("Second");
  });
});
