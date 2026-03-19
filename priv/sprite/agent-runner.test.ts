// agent-runner.test.ts — Tests for agent-runner with harness abstraction.
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "fs";
import {
  emit,
  loadConfig,
  loadPeers,
  processMessage,
  processInbox,
  processOutbox,
  type MessageEnvelope,
} from "./agent-runner";
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
    expect(() => createHarness("unknown" as never)).toThrow("Unknown harness type: unknown");
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

  test("emits agent_message_received event with from_agent and text", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({
      type: "agent_message",
      from: "researcher-bot",
      payload: { text: "Here is data." },
    });

    const events = await captureEmits(async () => {
      await processMessage(harness, envelope);
    });

    const received = events.find((e) => e.type === "agent_message_received");
    expect(received).toBeDefined();
    expect(received!.payload).toEqual({ from_agent: "researcher-bot", text: "Here is data." });
  });

  test("does not emit agent_message_received for user messages", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Hi" } });

    const events = await captureEmits(async () => {
      await processMessage(harness, envelope);
    });

    expect(events.find((e) => e.type === "agent_message_received")).toBeUndefined();
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

// ---------------------------------------------------------------------------
// loadConfig() — reads recipe.yaml
// ---------------------------------------------------------------------------

const TEST_AGENT_DIR = "/tmp/test-agent-dir-" + process.pid;

describe("loadConfig()", () => {
  beforeEach(() => {
    mkdirSync(TEST_AGENT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_AGENT_DIR, { recursive: true, force: true });
  });

  test("parses recipe.yaml into AgentConfig", async () => {
    const yaml = `version: 1
name: test-agent
description: A test agent
harness: pi
model: anthropic/claude-sonnet-4-6
system_prompt: You are helpful.
max_tokens: 8192
`;
    writeFileSync(`${TEST_AGENT_DIR}/recipe.yaml`, yaml);

    const config = await loadConfig(`${TEST_AGENT_DIR}/recipe.yaml`);
    expect(config.harness).toBe("pi");
    expect(config.model).toBe("anthropic/claude-sonnet-4-6");
    expect(config.system_prompt).toBe("You are helpful.");
    expect(config.max_tokens).toBe(8192);
  });

  test("applies defaults for missing fields", async () => {
    writeFileSync(`${TEST_AGENT_DIR}/recipe.yaml`, "version: 1\nname: minimal\n");

    const config = await loadConfig(`${TEST_AGENT_DIR}/recipe.yaml`);
    expect(config.harness).toBe("claude_code");
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.system_prompt).toBe("");
    expect(config.max_tokens).toBe(16384);
  });
});

// ---------------------------------------------------------------------------
// processOutbox() — routes outbox messages to target agent inboxes
// ---------------------------------------------------------------------------

const TEST_OUTBOX = "/tmp/test-outbox-" + process.pid;
const TEST_AGENTS_ROOT = "/tmp/test-agents-root-" + process.pid;
const TEST_PEERS_PATH = `${TEST_AGENTS_ROOT}/../peers.yaml`;
const TARGET_AGENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("processOutbox()", () => {
  beforeEach(async () => {
    mkdirSync(TEST_OUTBOX, { recursive: true });
    mkdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`, { recursive: true });
    // Write peers.yaml mapping name → UUID
    const peersYaml = `- id: "${TARGET_AGENT_ID}"\n  name: "target-agent"\n  description: "test"\n`;
    mkdirSync(`${TEST_AGENTS_ROOT}/..`, { recursive: true });
    writeFileSync(TEST_PEERS_PATH, peersYaml);
    await loadPeers(TEST_PEERS_PATH);
  });

  afterEach(() => {
    rmSync(TEST_OUTBOX, { recursive: true, force: true });
    rmSync(TEST_AGENTS_ROOT, { recursive: true, force: true });
    try {
      rmSync(TEST_PEERS_PATH);
    } catch {
      // ignore
    }
  });

  test("returns 0 when outbox is empty", async () => {
    const count = await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH);
    expect(count).toBe(0);
  });

  test("routes message to target agent inbox and removes outbox file", async () => {
    const msg = { to: "target-agent", text: "hello there" };
    writeFileSync(`${TEST_OUTBOX}/msg.json`, JSON.stringify(msg));

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH);
    });

    // Outbox file removed
    const remaining = readdirSync(TEST_OUTBOX).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(0);

    // Envelope written to target inbox (by UUID)
    const inboxFiles = readdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`).filter((f) => f.endsWith(".json"));
    expect(inboxFiles).toHaveLength(1);

    const raw = Bun.file(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox/${inboxFiles[0]}`);
    const envelope = JSON.parse(await raw.text());
    expect(envelope.type).toBe("agent_message");
    expect(envelope.payload.text).toBe("hello there");
    expect(typeof envelope.ts).toBe("number");

    // Emits agent_message_sent event
    const sent = events.find((e) => e.type === "agent_message_sent");
    expect(sent).toBeDefined();
    expect(sent!.payload).toEqual({
      to_agent: "target-agent",
      to_agent_id: TARGET_AGENT_ID,
      text: "hello there",
    });
  });

  test("sanitizes invalid JSON escape sequences and delivers message", async () => {
    // Simulates bash writing \! into JSON (invalid escape)
    writeFileSync(`${TEST_OUTBOX}/bad-escape.json`, '{"to":"target-agent","text":"Hello\\! world"}');

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH);
    });

    // File should be removed from outbox (delivered successfully)
    expect(existsSync(`${TEST_OUTBOX}/bad-escape.json`)).toBe(false);

    // Message should be delivered to target inbox
    const inboxFiles = readdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`).filter((f) => f.endsWith(".json"));
    expect(inboxFiles).toHaveLength(1);

    const sent = events.find((e) => e.type === "agent_message_sent");
    expect(sent).toBeDefined();
    expect(sent!.payload.text).toBe("Hello\\! world");
  });

  test("deletes truly unparseable outbox files", async () => {
    writeFileSync(`${TEST_OUTBOX}/broken.json`, "not json at all {{{");

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH);
    });

    // File should be deleted
    expect(existsSync(`${TEST_OUTBOX}/broken.json`)).toBe(false);

    // Should emit an error
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    expect(error!.payload.message).toContain("Invalid outbox message");
  });

  test("processes multiple outbox files", async () => {
    writeFileSync(`${TEST_OUTBOX}/a.json`, JSON.stringify({ to: "target-agent", text: "first" }));
    writeFileSync(`${TEST_OUTBOX}/b.json`, JSON.stringify({ to: "target-agent", text: "second" }));

    const count = await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH);
    expect(count).toBe(2);

    const inboxFiles = readdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`).filter((f) => f.endsWith(".json"));
    expect(inboxFiles).toHaveLength(2);
  });
});
