// agent-runner.test.ts — Tests for agent-runner with harness abstraction.
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";
import { emit, processMessage, processInbox, runRecipes, type MessageEnvelope } from "./agent-runner";
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

    await processMessage(harness, envelope);

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

    await processMessage(harness, envelope);

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
      await processMessage(harness, envelope);
    });

    expect(harness.interrupt).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("interrupted");
  });

  test("does not call harness.sendMessage for interrupt", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    await captureEmits(async () => {
      await processMessage(harness, envelope);
    });

    expect(harness.sendMessage).not.toHaveBeenCalled();
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
      await processMessage(harness, envelope);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("does not call harness.sendMessage for unknown types", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "noop", payload: {} });

    await processMessage(harness, envelope);

    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processInbox() — drain and return count
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runRecipes() — recipe execution
// ---------------------------------------------------------------------------

const TEST_RECIPE_DIR = "/tmp/test-recipe-" + process.pid;
const TEST_STATE_DIR = "/tmp/test-recipe-state-" + process.pid;

describe("runRecipes()", () => {
  beforeEach(() => {
    mkdirSync(TEST_STATE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_RECIPE_DIR, { recursive: true, force: true });
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });

  test("returns no_recipe when recipe file does not exist", async () => {
    const events = await captureEmits(async () => {
      const result = await runRecipes("/tmp/nonexistent-recipe.json", TEST_STATE_DIR);
      expect(result.status).toBe("no_recipe");
    });
    expect(events.some((e) => e.type === "recipe_complete")).toBe(true);
  });

  test("returns no_scripts when recipe has empty scripts array", async () => {
    const recipePath = `${TEST_RECIPE_DIR}/recipe.json`;
    mkdirSync(TEST_RECIPE_DIR, { recursive: true });
    writeFileSync(recipePath, JSON.stringify({ scripts: [] }));

    const events = await captureEmits(async () => {
      const result = await runRecipes(recipePath, TEST_STATE_DIR);
      expect(result.status).toBe("no_scripts");
    });
    expect(events.some((e) => e.type === "recipe_complete")).toBe(true);
  });

  test("runs scripts and returns done (mocked spawn)", async () => {
    const recipePath = `${TEST_RECIPE_DIR}/recipe.json`;
    mkdirSync(TEST_RECIPE_DIR, { recursive: true });
    writeFileSync(recipePath, JSON.stringify({ scripts: [{ name: "test-step", run: "echo hello" }] }));

    const originalSpawn = Bun.spawn;
    Bun.spawn = (() => ({
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
      exited: Promise.resolve(0),
    })) as unknown as typeof Bun.spawn;

    try {
      const events = await captureEmits(async () => {
        const result = await runRecipes(recipePath, TEST_STATE_DIR);
        expect(result.status).toBe("done");
      });
      expect(events.some((e) => e.type === "recipe_step" && e.payload.name === "test-step")).toBe(true);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("skips scripts with matching marker", async () => {
    const recipePath = `${TEST_RECIPE_DIR}/recipe.json`;
    mkdirSync(TEST_RECIPE_DIR, { recursive: true });
    writeFileSync(recipePath, JSON.stringify({ scripts: [{ name: "test-step", run: "echo hello" }] }));

    const originalSpawn = Bun.spawn;
    Bun.spawn = (() => ({
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
      exited: Promise.resolve(0),
    })) as unknown as typeof Bun.spawn;

    try {
      // Run once to create marker
      await captureEmits(async () => {
        await runRecipes(recipePath, TEST_STATE_DIR);
      });

      // Run again — should skip
      const events = await captureEmits(async () => {
        const result = await runRecipes(recipePath, TEST_STATE_DIR);
        expect(result.status).toBe("done");
      });
      expect(events.some((e) => e.type === "recipe_step" && e.payload.status === "skipped")).toBe(true);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("returns failed when a script fails (mocked spawn)", async () => {
    const recipePath = `${TEST_RECIPE_DIR}/recipe.json`;
    mkdirSync(TEST_RECIPE_DIR, { recursive: true });
    writeFileSync(recipePath, JSON.stringify({ scripts: [{ name: "bad-step", run: "exit 1" }] }));

    const originalSpawn = Bun.spawn;
    Bun.spawn = (() => ({
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
      exited: Promise.resolve(1),
    })) as unknown as typeof Bun.spawn;

    try {
      const events = await captureEmits(async () => {
        const result = await runRecipes(recipePath, TEST_STATE_DIR);
        expect(result.status).toBe("failed");
        expect(result.failed_step).toBe("bad-step");
      });
      expect(events.some((e) => e.type === "recipe_step" && e.payload.status === "failed")).toBe(true);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});

// ---------------------------------------------------------------------------
// processInbox() — drain and return count
// ---------------------------------------------------------------------------

const TEST_INBOX = "/tmp/test-inbox-" + process.pid;

describe("processInbox()", () => {
  beforeEach(() => {
    mkdirSync(TEST_INBOX, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_INBOX, { recursive: true, force: true });
  });

  test("returns 0 when inbox is empty", async () => {
    const harness = createMockHarness();
    const count = await processInbox(harness, TEST_INBOX);
    expect(count).toBe(0);
  });

  test("returns count of processed messages", async () => {
    const harness = createMockHarness();
    const envelope = { ts: Date.now(), type: "user_message", from: "coordinator", payload: { text: "hi" } };
    writeFileSync(`${TEST_INBOX}/1.json`, JSON.stringify(envelope));
    writeFileSync(`${TEST_INBOX}/2.json`, JSON.stringify(envelope));

    const count = await processInbox(harness, TEST_INBOX);
    expect(count).toBe(2);
    expect(harness.sendMessage).toHaveBeenCalledTimes(2);
  });

  test("removes processed files from inbox", async () => {
    const harness = createMockHarness();
    const envelope = { ts: Date.now(), type: "user_message", from: "coordinator", payload: { text: "hi" } };
    writeFileSync(`${TEST_INBOX}/1.json`, JSON.stringify(envelope));

    await processInbox(harness, TEST_INBOX);
    const remaining = readdirSync(TEST_INBOX).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(0);
  });
});
