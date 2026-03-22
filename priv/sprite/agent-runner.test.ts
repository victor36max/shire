// agent-runner.test.ts — Tests for agent-runner with harness abstraction.
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import {
  emit,
  loadConfig,
  loadPeers,
  processMessage,
  processInbox,
  processOutbox,
  writeSystemMessage,
  tryHandleInterrupt,
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

function readYamlFile(path: string): unknown {
  return yaml.load(readFileSync(path, "utf-8"));
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

  test("emits agent_message_received before calling harness.sendMessage", async () => {
    const callOrder: string[] = [];
    const harness = createMockHarness();
    harness.sendMessage = mock(async () => {
      callOrder.push("sendMessage");
    });
    const origWrite = process.stdout.write.bind(process.stdout);
    const spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string" && chunk.includes("agent_message_received")) {
        callOrder.push("emit");
      }
      return origWrite(chunk as string);
    });

    const envelope = makeEnvelope({
      type: "agent_message",
      from: "researcher-bot",
      payload: { text: "Here is data." },
    });

    await processMessage(harness, envelope);
    spy.mockRestore();

    expect(callOrder).toEqual(["emit", "sendMessage"]);
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
// processMessage() — system_message
// ---------------------------------------------------------------------------

describe("processMessage() — system_message", () => {
  test("sends text with [System] prefix to harness", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({
      type: "system_message",
      from: "system",
      payload: { text: "Your message was invalid." },
    });

    await processMessage(harness, envelope);

    expect(harness.sendMessage).toHaveBeenCalledWith("[System] Your message was invalid.", undefined);
  });

  test("emits system_message_received event", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({
      type: "system_message",
      from: "system",
      payload: { text: "Error details here." },
    });

    const events = await captureEmits(async () => {
      await processMessage(harness, envelope);
    });

    const received = events.find((e) => e.type === "system_message_received");
    expect(received).toBeDefined();
    expect(received!.payload).toEqual({ text: "Error details here." });
  });

  test("emits system_message_received before calling harness.sendMessage", async () => {
    const callOrder: string[] = [];
    const harness = createMockHarness();
    harness.sendMessage = mock(async () => {
      callOrder.push("sendMessage");
    });
    const origWrite = process.stdout.write.bind(process.stdout);
    const spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string" && chunk.includes("system_message_received")) {
        callOrder.push("emit");
      }
      return origWrite(chunk as string);
    });

    const envelope = makeEnvelope({
      type: "system_message",
      from: "system",
      payload: { text: "Error details here." },
    });

    await processMessage(harness, envelope);
    spy.mockRestore();

    expect(callOrder).toEqual(["emit", "sendMessage"]);
  });

  test("does not emit agent_message_received for system messages", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({
      type: "system_message",
      from: "system",
      payload: { text: "Error." },
    });

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
    writeFileSync(`${TEST_INBOX}/1.yaml`, yaml.dump(envelope));
    writeFileSync(`${TEST_INBOX}/2.yaml`, yaml.dump(envelope));

    const count = await processInbox(harness, TEST_INBOX);
    expect(count).toBe(2);
    expect(harness.sendMessage).toHaveBeenCalledTimes(2);
  });

  test("removes processed files from inbox", async () => {
    const harness = createMockHarness();
    const envelope = { ts: Date.now(), type: "user_message", from: "coordinator", payload: { text: "hi" } };
    writeFileSync(`${TEST_INBOX}/1.yaml`, yaml.dump(envelope));

    await processInbox(harness, TEST_INBOX);
    const remaining = readdirSync(TEST_INBOX).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(remaining).toHaveLength(0);
  });

  test("processes .yml files as well", async () => {
    const harness = createMockHarness();
    const envelope = { ts: Date.now(), type: "user_message", from: "coordinator", payload: { text: "hi" } };
    writeFileSync(`${TEST_INBOX}/1.yml`, yaml.dump(envelope));

    const count = await processInbox(harness, TEST_INBOX);
    expect(count).toBe(1);
    expect(harness.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("deletes broken inbox files to prevent infinite retry", async () => {
    const harness = createMockHarness();
    writeFileSync(`${TEST_INBOX}/broken.yaml`, "invalid: yaml: [unterminated");

    await processInbox(harness, TEST_INBOX);

    expect(existsSync(`${TEST_INBOX}/broken.yaml`)).toBe(false);
    expect(harness.sendMessage).not.toHaveBeenCalled();
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
    const recipeYaml = `version: 1
name: test-agent
description: A test agent
harness: pi
model: anthropic/claude-sonnet-4-6
system_prompt: You are helpful.
max_tokens: 8192
`;
    writeFileSync(`${TEST_AGENT_DIR}/recipe.yaml`, recipeYaml);

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
const TEST_SENDER_INBOX = "/tmp/test-sender-inbox-" + process.pid;

describe("processOutbox()", () => {
  beforeEach(async () => {
    mkdirSync(TEST_OUTBOX, { recursive: true });
    mkdirSync(TEST_SENDER_INBOX, { recursive: true });
    mkdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`, { recursive: true });
    // Write peers.yaml mapping name → UUID
    const peersYaml = `- id: "${TARGET_AGENT_ID}"\n  name: "target-agent"\n  description: "test"\n`;
    mkdirSync(`${TEST_AGENTS_ROOT}/..`, { recursive: true });
    writeFileSync(TEST_PEERS_PATH, peersYaml);
    await loadPeers(TEST_PEERS_PATH);
  });

  afterEach(() => {
    rmSync(TEST_OUTBOX, { recursive: true, force: true });
    rmSync(TEST_SENDER_INBOX, { recursive: true, force: true });
    rmSync(TEST_AGENTS_ROOT, { recursive: true, force: true });
    try {
      rmSync(TEST_PEERS_PATH);
    } catch {
      // ignore
    }
  });

  test("returns 0 when outbox is empty", async () => {
    const count = await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    expect(count).toBe(0);
  });

  test("routes message to target agent inbox and removes outbox file", async () => {
    writeFileSync(`${TEST_OUTBOX}/msg.yaml`, yaml.dump({ to: "target-agent", text: "hello there" }));

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    });

    // Outbox file removed
    const remaining = readdirSync(TEST_OUTBOX).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(remaining).toHaveLength(0);

    // Envelope written to target inbox as YAML
    const inboxFiles = readdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
    expect(inboxFiles).toHaveLength(1);

    const envelope = readYamlFile(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox/${inboxFiles[0]}`) as Record<
      string,
      unknown
    >;
    expect(envelope.type).toBe("agent_message");
    expect((envelope.payload as Record<string, unknown>).text).toBe("hello there");
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

  test("deletes unparseable outbox files and writes system_message to sender inbox", async () => {
    writeFileSync(`${TEST_OUTBOX}/broken.yaml`, "invalid: yaml: [unterminated");

    let count = 0;
    const events = await captureEmits(async () => {
      count = await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    });

    // Invalid files should not count as routed
    expect(count).toBe(0);

    // Outbox file should be deleted
    expect(existsSync(`${TEST_OUTBOX}/broken.yaml`)).toBe(false);

    // Should emit an error
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    expect(error!.payload.message).toContain("Invalid outbox message");

    // Should write system_message to sender inbox
    const inboxFiles = readdirSync(TEST_SENDER_INBOX).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(inboxFiles).toHaveLength(1);
    const sysMsg = readYamlFile(`${TEST_SENDER_INBOX}/${inboxFiles[0]}`) as Record<string, unknown>;
    expect(sysMsg.type).toBe("system_message");
    expect((sysMsg.payload as Record<string, unknown>).text).toContain("could not be parsed as YAML");
  });

  test("deletes outbox files missing required fields and writes system_message", async () => {
    writeFileSync(`${TEST_OUTBOX}/no-to.yaml`, yaml.dump({ text: "hello" }));

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    });

    // Outbox file should be deleted
    expect(existsSync(`${TEST_OUTBOX}/no-to.yaml`)).toBe(false);

    // Should emit an error about missing fields
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    expect(error!.payload.message).toContain("missing required fields");

    // Should write system_message to sender inbox
    const inboxFiles = readdirSync(TEST_SENDER_INBOX).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(inboxFiles).toHaveLength(1);
    const sysMsg = readYamlFile(`${TEST_SENDER_INBOX}/${inboxFiles[0]}`) as Record<string, unknown>;
    expect(sysMsg.type).toBe("system_message");
    expect((sysMsg.payload as Record<string, unknown>).text).toContain('"to" (string)');
  });

  test("deletes outbox files with wrong field types and writes system_message", async () => {
    writeFileSync(`${TEST_OUTBOX}/bad-types.yaml`, yaml.dump({ to: 123, text: true }));

    await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    });

    expect(existsSync(`${TEST_OUTBOX}/bad-types.yaml`)).toBe(false);

    const inboxFiles = readdirSync(TEST_SENDER_INBOX).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(inboxFiles).toHaveLength(1);
    const sysMsg = readYamlFile(`${TEST_SENDER_INBOX}/${inboxFiles[0]}`) as Record<string, unknown>;
    expect(sysMsg.type).toBe("system_message");
  });

  test("processes .yml outbox files", async () => {
    writeFileSync(`${TEST_OUTBOX}/msg.yml`, yaml.dump({ to: "target-agent", text: "yml test" }));

    const events = await captureEmits(async () => {
      await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    });

    expect(existsSync(`${TEST_OUTBOX}/msg.yml`)).toBe(false);
    const sent = events.find((e) => e.type === "agent_message_sent");
    expect(sent).toBeDefined();
    expect(sent!.payload.text).toBe("yml test");
  });

  test("processes multiple outbox files", async () => {
    writeFileSync(`${TEST_OUTBOX}/a.yaml`, yaml.dump({ to: "target-agent", text: "first" }));
    writeFileSync(`${TEST_OUTBOX}/b.yaml`, yaml.dump({ to: "target-agent", text: "second" }));

    const count = await processOutbox(TEST_OUTBOX, TEST_AGENTS_ROOT, TEST_PEERS_PATH, TEST_SENDER_INBOX);
    expect(count).toBe(2);

    const inboxFiles = readdirSync(`${TEST_AGENTS_ROOT}/${TARGET_AGENT_ID}/inbox`).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
    expect(inboxFiles).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// writeSystemMessage() — writes system_message envelope to inbox
// ---------------------------------------------------------------------------

const TEST_SYS_INBOX = "/tmp/test-sys-inbox-" + process.pid;

describe("writeSystemMessage()", () => {
  beforeEach(() => {
    mkdirSync(TEST_SYS_INBOX, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_SYS_INBOX, { recursive: true, force: true });
  });

  test("writes a valid YAML system_message envelope", async () => {
    await writeSystemMessage(TEST_SYS_INBOX, "Something went wrong.");

    const files = readdirSync(TEST_SYS_INBOX).filter((f) => f.endsWith(".yaml"));
    expect(files).toHaveLength(1);

    const envelope = readYamlFile(`${TEST_SYS_INBOX}/${files[0]}`) as Record<string, unknown>;
    expect(envelope.type).toBe("system_message");
    expect(envelope.from).toBe("system");
    expect(typeof envelope.ts).toBe("number");
    expect((envelope.payload as Record<string, unknown>).text).toBe("Something went wrong.");
  });
});

// ---------------------------------------------------------------------------
// tryHandleInterrupt()
// ---------------------------------------------------------------------------

describe("tryHandleInterrupt()", () => {
  const TEST_INTERRUPT_INBOX = "/tmp/test-interrupt-inbox";

  beforeEach(() => {
    rmSync(TEST_INTERRUPT_INBOX, { recursive: true, force: true });
    mkdirSync(TEST_INTERRUPT_INBOX, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_INTERRUPT_INBOX, { recursive: true, force: true });
  });

  test("calls harness.interrupt() and returns true for interrupt envelope", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });
    const filename = "001-int.yaml";
    writeFileSync(`${TEST_INTERRUPT_INBOX}/${filename}`, yaml.dump(envelope));

    const events = await captureEmits(async () => {
      const result = await tryHandleInterrupt(harness, filename, TEST_INTERRUPT_INBOX);
      expect(result).toBe(true);
    });

    expect(harness.interrupt).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("interrupted");
    expect(existsSync(`${TEST_INTERRUPT_INBOX}/${filename}`)).toBe(false);
  });

  test("returns false and leaves file for non-interrupt envelope", async () => {
    const harness = createMockHarness();
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Hi" } });
    const filename = "002-msg.yaml";
    writeFileSync(`${TEST_INTERRUPT_INBOX}/${filename}`, yaml.dump(envelope));

    const result = await tryHandleInterrupt(harness, filename, TEST_INTERRUPT_INBOX);

    expect(result).toBe(false);
    expect(harness.interrupt).not.toHaveBeenCalled();
    expect(existsSync(`${TEST_INTERRUPT_INBOX}/${filename}`)).toBe(true);
  });

  test("returns false without crashing for non-existent file", async () => {
    const harness = createMockHarness();

    const result = await tryHandleInterrupt(harness, "does-not-exist.yaml", TEST_INTERRUPT_INBOX);

    expect(result).toBe(false);
    expect(harness.interrupt).not.toHaveBeenCalled();
  });
});
