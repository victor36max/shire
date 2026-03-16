import { describe, test, expect, mock } from "bun:test";
import { ClaudeCodeHarness } from "./claude-code-harness";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
  maxTokens: 4096,
};

// Helper: create a mock spawner that returns configurable stdout lines
function createMockSpawner(lines: string[]) {
  return mock((_cmd: string[], _opts: Record<string, unknown>) => {
    const encoder = new TextEncoder();
    const data = lines.map((l) => l + "\n").join("");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    });

    return {
      stdout: stream,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
    };
  });
}

describe("ClaudeCodeHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new ClaudeCodeHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("start() is a no-op that does not throw", async () => {
    const harness = new ClaudeCodeHarness();
    await harness.start(baseConfig);
  });

  test("sendMessage() constructs correct CLI args", async () => {
    const spawner = createMockSpawner(['{"type":"result","subtype":"success","result":"Hi","session_id":"s1"}']);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("Hello");

    expect(spawner).toHaveBeenCalledTimes(1);
    const [cmd] = spawner.mock.calls[0];
    expect(cmd[0]).toBe("claude");
    expect(cmd).toContain("-p");
    expect(cmd).toContain("Hello");
    expect(cmd).toContain("--output-format");
    expect(cmd).toContain("stream-json");
    expect(cmd).toContain("--model");
    expect(cmd).toContain("claude-sonnet-4-6");
    expect(cmd).toContain("--append-system-prompt");
  });

  test("sendMessage() captures session_id from result event", async () => {
    const spawner = createMockSpawner(['{"type":"result","subtype":"success","result":"Hi","session_id":"sess-123"}']);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("First message");

    // Second call should include --resume
    spawner.mockImplementation(
      createMockSpawner(['{"type":"result","subtype":"success","result":"Ok","session_id":"sess-123"}']),
    );
    await harness.sendMessage("Second message");

    const [cmd2] = spawner.mock.calls[1];
    expect(cmd2).toContain("--resume");
    expect(cmd2).toContain("sess-123");
  });

  test("sendMessage() emits text_delta from stream_event", async () => {
    const spawner = createMockSpawner([
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}}',
      '{"type":"result","subtype":"success","result":"Hello world","session_id":"s1"}',
    ]);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const delta = events.find((e) => e.type === "text_delta");
    expect(delta).toBeDefined();
    expect(delta!.payload.delta).toBe("Hello");
  });

  test("sendMessage() emits text and turn_complete from result", async () => {
    const spawner = createMockSpawner([
      '{"type":"result","subtype":"success","result":"Full response","session_id":"s1"}',
    ]);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
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
    const spawner = createMockSpawner([
      '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"bash"}}}',
      '{"type":"result","subtype":"success","result":"done","session_id":"s1"}',
    ]);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("run ls");

    const toolEvent = events.find((e) => e.type === "tool_use");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.payload.tool).toBe("bash");
    expect(toolEvent!.payload.status).toBe("started");
  });

  test("sendMessage() emits error on non-zero exit", async () => {
    const spawner = mock((_cmd: string[], _opts: Record<string, unknown>) => ({
      stdout: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exited: Promise.resolve(1),
      kill: mock(() => {}),
    }));
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.sendMessage("test");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("exit code 1");
  });

  test("interrupt() clears session ID", async () => {
    const spawner = createMockSpawner(['{"type":"result","subtype":"success","result":"Hi","session_id":"sess-abc"}']);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("First");
    await harness.interrupt();

    // Next call should NOT include --resume
    spawner.mockImplementation(
      createMockSpawner(['{"type":"result","subtype":"success","result":"Fresh","session_id":"sess-new"}']),
    );
    await harness.sendMessage("After interrupt");

    const [cmd] = spawner.mock.calls[spawner.mock.calls.length - 1];
    expect(cmd).not.toContain("--resume");
  });

  test("isProcessing() tracks subprocess lifecycle", async () => {
    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>((r) => {
      resolveExit = r;
    });

    const spawner = mock((_cmd: string[], _opts: Record<string, unknown>) => ({
      stdout: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exited: exitPromise,
      kill: mock(() => {}),
    }));

    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});
    await harness.start(baseConfig);

    const sendPromise = harness.sendMessage("test");
    // Processing should be true while subprocess is running
    expect(harness.isProcessing()).toBe(true);

    resolveExit!(0);
    await sendPromise;
    expect(harness.isProcessing()).toBe(false);
  });

  test("stop() suppresses further event emission", async () => {
    const spawner = createMockSpawner(['{"type":"result","subtype":"success","result":"Hi","session_id":"s1"}']);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));

    await harness.start(baseConfig);
    await harness.stop();

    await harness.sendMessage("should not emit");
    expect(events).toHaveLength(0);
  });
});
