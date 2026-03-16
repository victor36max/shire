// agent-runner.test.ts — Tests for agent-runner with harness abstraction.
import { describe, test, expect, mock, spyOn } from "bun:test";
import { emit, processMessage, type AgentConfig, type MessageEnvelope } from "./agent-runner";
import type { Harness } from "./harness";
import { createHarness } from "./harness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureEmits(
  fn: () => void | Promise<void>,
): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  const lines: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    if (typeof chunk === "string") {
      chunk
        .split("\n")
        .filter(Boolean)
        .forEach((l) => lines.push(l));
    }
    return true;
  });

  try {
    await fn();
  } finally {
    spy.mockRestore();
  }

  return lines.map((l) => JSON.parse(l));
}

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    seq: 1,
    ts: Date.now(),
    type: "user_message",
    from: "orchestrator",
    payload: { text: "Hello" },
    ...overrides,
  };
}

function createMockHarness(): Harness & {
  sendMessage: ReturnType<typeof mock>;
  interrupt: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
  start: ReturnType<typeof mock>;
} {
  return {
    start: mock(async () => {}),
    sendMessage: mock(async () => {}),
    interrupt: mock(async () => {}),
    stop: mock(async () => {}),
    onEvent: mock(() => {}),
    isProcessing: mock(() => false),
  };
}

const baseConfig: AgentConfig = {
  harness: "pi",
  model: "anthropic/claude-sonnet-4-6",
  system_prompt: "You are a helpful assistant.",
  max_tokens: 1024,
};

// ---------------------------------------------------------------------------
// emit()
// ---------------------------------------------------------------------------

describe("emit()", () => {
  test("writes a JSONL line with type and payload to stdout", async () => {
    const events = await captureEmits(() => {
      emit("ready", { model: "claude-sonnet-4-6" });
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "ready", payload: { model: "claude-sonnet-4-6" } });
  });

  test("defaults payload to empty object when omitted", async () => {
    const events = await captureEmits(() => {
      emit("heartbeat");
    });
    expect(events[0]).toEqual({ type: "heartbeat", payload: {} });
  });

  test("output is valid JSON terminated by a newline", async () => {
    const lines: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    });
    emit("test_event", { key: "value" });
    spy.mockRestore();
    expect(lines[0].endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({ type: "test_event", payload: { key: "value" } });
  });
});

// ---------------------------------------------------------------------------
// createHarness() factory
// ---------------------------------------------------------------------------

describe("createHarness()", () => {
  test("throws on unknown harness type", () => {
    expect(() => createHarness("unknown")).toThrow("Unknown harness type: unknown");
  });

  test("returns a harness for 'pi'", () => {
    const harness = createHarness("pi");
    expect(harness).toBeDefined();
    expect(harness.start).toBeInstanceOf(Function);
    expect(harness.sendMessage).toBeInstanceOf(Function);
  });

  test("returns a harness for 'claude_code'", () => {
    const harness = createHarness("claude_code");
    expect(harness).toBeDefined();
    expect(harness.start).toBeInstanceOf(Function);
  });
});

// ---------------------------------------------------------------------------
// processMessage() — user_message
// ---------------------------------------------------------------------------

describe("processMessage() — user_message", () => {
  test("delegates to harness.sendMessage with text", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Hi there" } });

    await processMessage(harness, { ...baseConfig }, envelope);

    expect(harness.sendMessage).toHaveBeenCalledWith("Hi there", undefined);
  });
});

// ---------------------------------------------------------------------------
// processMessage() — agent_message
// ---------------------------------------------------------------------------

describe("processMessage() — agent_message", () => {
  test("delegates with from parameter for agent messages", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({
      type: "agent_message",
      from: "researcher-bot",
      payload: { text: "Here is data." },
    });

    await processMessage(harness, { ...baseConfig }, envelope);

    expect(harness.sendMessage).toHaveBeenCalledWith("Here is data.", "researcher-bot");
  });
});

// ---------------------------------------------------------------------------
// processMessage() — interrupt
// ---------------------------------------------------------------------------

describe("processMessage() — interrupt", () => {
  test("calls harness.interrupt() and emits interrupted event", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    const events = await captureEmits(async () => {
      await processMessage(harness, { ...baseConfig }, envelope);
    });

    expect(harness.interrupt).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("interrupted");
  });

  test("does not call harness.sendMessage for interrupt", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    await captureEmits(async () => {
      await processMessage(harness, { ...baseConfig }, envelope);
    });

    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processMessage() — configure
// ---------------------------------------------------------------------------

describe("processMessage() — configure", () => {
  test("stops old harness and emits configured event", async () => {
    const harness = createMockHarness();
    const config: AgentConfig = { ...baseConfig };
    const newConfig: AgentConfig = {
      harness: "pi",
      model: "anthropic/claude-haiku-4-5",
      system_prompt: "Updated.",
      max_tokens: 2048,
    };
    const fakeLoadConfig = mock(async () => newConfig);
    const envelope = makeEnvelope({ type: "configure", payload: {} });

    const events = await captureEmits(async () => {
      await processMessage(harness, config, envelope, fakeLoadConfig);
    });

    expect(harness.stop).toHaveBeenCalled();
    expect(fakeLoadConfig).toHaveBeenCalledTimes(1);
    expect(config.model).toBe("anthropic/claude-haiku-4-5");

    const configuredEvent = events.find((e) => e.type === "configured");
    expect(configuredEvent).toBeDefined();
    expect(configuredEvent!.payload.model).toBe("anthropic/claude-haiku-4-5");
  });

  test("returns a new harness instance after configure", async () => {
    const harness = createMockHarness();
    const config: AgentConfig = { ...baseConfig };
    const fakeLoadConfig = mock(async () => ({ ...baseConfig }));
    const envelope = makeEnvelope({ type: "configure", payload: {} });

    let result: { harness: Harness; config: AgentConfig } | undefined;
    await captureEmits(async () => {
      result = await processMessage(harness, config, envelope, fakeLoadConfig);
    });

    // The returned harness should be different from the original mock
    expect(result!.harness).not.toBe(harness);
    expect(result!.harness.start).toBeInstanceOf(Function);
  });

  test("does not call harness.sendMessage for configure", async () => {
    const harness = createMockHarness();
    const fakeLoadConfig = mock(async () => ({ ...baseConfig }));
    const envelope = makeEnvelope({ type: "configure", payload: {} });

    await captureEmits(async () => {
      await processMessage(harness, { ...baseConfig }, envelope, fakeLoadConfig);
    });

    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processMessage() — shutdown
// ---------------------------------------------------------------------------

describe("processMessage() — shutdown", () => {
  test("calls harness.stop() and emits shutdown event", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "shutdown", payload: {} });

    // Capture stdout manually so we retain lines even if process.exit throws
    const lines: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") {
        chunk
          .split("\n")
          .filter(Boolean)
          .forEach((l) => lines.push(l));
      }
      return true;
    });

    // Mock process.exit to prevent actual exit
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });

    let exitCalledWith: number | undefined;
    try {
      await processMessage(harness, { ...baseConfig }, envelope);
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== "EXIT") throw e;
    } finally {
      // Record the call before restoring so assertions work after restore
      const calls = exitSpy.mock.calls;
      exitCalledWith = calls.length > 0 ? (calls[0][0] as number) : undefined;
      writeSpy.mockRestore();
      exitSpy.mockRestore();
    }

    const events = lines.map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> });

    expect(harness.stop).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("shutdown");
    expect(exitCalledWith).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// processMessage() — unknown type
// ---------------------------------------------------------------------------

describe("processMessage() — unknown type", () => {
  test("does not throw for an unrecognised message type", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "some_future_type", payload: {} });

    let threw = false;
    try {
      await processMessage(harness, { ...baseConfig }, envelope);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("does not call harness.sendMessage for unknown types", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "noop", payload: {} });

    await processMessage(harness, { ...baseConfig }, envelope);

    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});
