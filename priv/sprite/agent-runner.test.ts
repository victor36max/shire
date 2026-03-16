// agent-runner.test.ts — Unit tests for exported agent-runner functions.
import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { emit, processMessage, type AgentConfig, type MessageEnvelope } from "./agent-runner";
import Anthropic from "@anthropic-ai/sdk";
import { createHarness } from "./harness";

// ---------------------------------------------------------------------------
// createHarness()
// ---------------------------------------------------------------------------

describe("createHarness()", () => {
  test("throws on unknown harness type", () => {
    expect(() => createHarness("unknown")).toThrow("Unknown harness type: unknown");
  });

  test("returns a PiHarness for 'pi'", () => {
    const harness = createHarness("pi");
    expect(harness).toBeDefined();
    expect(harness.start).toBeInstanceOf(Function);
    expect(harness.sendMessage).toBeInstanceOf(Function);
    expect(harness.interrupt).toBeInstanceOf(Function);
    expect(harness.stop).toBeInstanceOf(Function);
    expect(harness.onEvent).toBeInstanceOf(Function);
    expect(harness.isProcessing).toBeInstanceOf(Function);
  });

  test("returns a ClaudeCodeHarness for 'claude_code'", () => {
    const harness = createHarness("claude_code");
    expect(harness).toBeDefined();
    expect(harness.start).toBeInstanceOf(Function);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture all stdout writes during a callback, return them as an array of
 *  parsed JSONL objects (one per newline-terminated write). */
async function captureEmits(fn: () => void | Promise<void>): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  const lines: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    if (typeof chunk === "string") {
      chunk.split("\n").filter(Boolean).forEach((l) => lines.push(l));
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

/** Build a minimal valid MessageEnvelope for tests. */
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

/** Build a mock Anthropic stream whose on("text", cb) fires immediately and
 *  whose finalMessage() resolves to a fixed response. */
function makeMockStream(responseText = "Hello from AI") {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") {
        // Fire one text delta synchronously so tests can assert on it
        cb(responseText);
      }
      return this;
    },
    async finalMessage() {
      return {
        content: [{ type: "text", text: responseText }],
        role: "assistant",
        id: "msg_test",
        model: "claude-test",
        stop_reason: "end_turn",
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 10, output_tokens: 5 },
      } satisfies Anthropic.Message;
    },
  };
}

/** Build a mock Anthropic client whose messages.stream returns the given stream. */
function makeMockClient(responseText = "Hello from AI") {
  return {
    messages: {
      stream: mock(() => makeMockStream(responseText)),
    },
  } as unknown as Anthropic;
}

const baseConfig: AgentConfig = {
  model: "claude-opus-4-5",
  system_prompt: "You are a helpful assistant.",
  max_tokens: 1024,
};

// ---------------------------------------------------------------------------
// emit()
// ---------------------------------------------------------------------------

describe("emit()", () => {
  test("writes a JSONL line with type and payload to stdout", async () => {
    const events = await captureEmits(() => {
      emit("ready", { model: "claude-opus-4-5" });
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "ready", payload: { model: "claude-opus-4-5" } });
  });

  test("defaults payload to empty object when omitted", async () => {
    const events = await captureEmits(() => {
      emit("heartbeat");
    });

    expect(events).toHaveLength(1);
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

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({ type: "test_event", payload: { key: "value" } });
  });

  test("serialises complex nested payloads correctly", async () => {
    const events = await captureEmits(() => {
      emit("error", { message: "oops", details: { code: 42, tags: ["a", "b"] } });
    });

    expect(events[0].payload).toEqual({ message: "oops", details: { code: 42, tags: ["a", "b"] } });
  });
});

// ---------------------------------------------------------------------------
// processMessage() — user_message
// ---------------------------------------------------------------------------

describe("processMessage() — user_message", () => {
  test("appends user message to messages array and emits turn_complete", async () => {
    const client = makeMockClient("AI response");
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Hi there" } });

    const events = await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    // messages array should now have user + assistant entries
    expect(messages[0]).toEqual({ role: "user", content: "Hi there" });
    expect(messages[1]).toEqual({ role: "assistant", content: "AI response" });

    const types = events.map((e) => e.type);
    expect(types).toContain("text_delta");
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
  });

  test("passes correct parameters to the Anthropic stream call", async () => {
    // Capture the argument snapshot at call-time before the assistant reply is appended.
    let capturedArgs: unknown = null;
    const client = {
      messages: {
        stream: mock((args: unknown) => {
          capturedArgs = JSON.parse(JSON.stringify(args)); // deep clone at call-time
          return makeMockStream();
        }),
      },
    } as unknown as Anthropic;

    const messages: Anthropic.MessageParam[] = [];
    const config: AgentConfig = { model: "claude-haiku-4-5", system_prompt: "Be concise.", max_tokens: 512 };
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Ping" } });

    await captureEmits(async () => {
      await processMessage(client, config, messages, envelope);
    });

    expect(capturedArgs).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: "Be concise.",
      messages: [{ role: "user", content: "Ping" }],
    });
  });

  test("uses default max_tokens of 4096 when not set in config", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const configNoMax: AgentConfig = { model: "claude-opus-4-5", system_prompt: "Help." };
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Test" } });

    await captureEmits(async () => {
      await processMessage(client, configNoMax, messages, envelope);
    });

    expect(client.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 })
    );
  });

  test("emits error event when stream throws", async () => {
    const client = {
      messages: {
        stream: mock(() => {
          throw new Error("Network failure");
        }),
      },
    } as unknown as Anthropic;

    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ type: "user_message", payload: { text: "Oops" } });

    const events = await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("Network failure");
  });
});

// ---------------------------------------------------------------------------
// processMessage() — agent_message
// ---------------------------------------------------------------------------

describe("processMessage() — agent_message", () => {
  test("prepends agent attribution prefix to the message text", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({
      type: "agent_message",
      from: "researcher-bot",
      payload: { text: "Here is the summary." },
    });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(messages[0]).toEqual({
      role: "user",
      content: '[Message from agent "researcher-bot"]\nHere is the summary.',
    });
  });

  test("emits turn_complete after successful agent_message processing", async () => {
    const client = makeMockClient("Response");
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({
      type: "agent_message",
      from: "sub-agent",
      payload: { text: "Data received." },
    });

    const events = await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(events.map((e) => e.type)).toContain("turn_complete");
  });
});

// ---------------------------------------------------------------------------
// processMessage() — interrupt
// ---------------------------------------------------------------------------

describe("processMessage() — interrupt", () => {
  test("clears all messages from the conversation history", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Previous message" },
      { role: "assistant", content: "Previous reply" },
    ];
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(messages).toHaveLength(0);
  });

  test("emits interrupted event", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "msg" }];
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    const events = await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(events.map((e) => e.type)).toContain("interrupted");
  });

  test("does not call the Anthropic API for interrupt messages", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ type: "interrupt", payload: {} });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(client.messages.stream).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processMessage() — configure
// ---------------------------------------------------------------------------

describe("processMessage() — configure", () => {
  test("hot-reloads config and emits configured event with new model", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const config: AgentConfig = { ...baseConfig };

    const newConfig: AgentConfig = {
      model: "claude-haiku-4-5",
      system_prompt: "Updated prompt.",
      max_tokens: 2048,
    };

    // Inject a fake loadConfigFn via the optional 5th parameter
    const fakeLoadConfig = mock(async () => newConfig);

    const envelope = makeEnvelope({ type: "configure", payload: {} });

    const events = await captureEmits(async () => {
      await processMessage(client, config, messages, envelope, fakeLoadConfig);
    });

    // loadConfigFn should have been called exactly once
    expect(fakeLoadConfig).toHaveBeenCalledTimes(1);

    // config object should be mutated in-place with new values
    expect(config.model).toBe("claude-haiku-4-5");
    expect(config.system_prompt).toBe("Updated prompt.");
    expect(config.max_tokens).toBe(2048);

    // configured event should be emitted with the new model
    const configuredEvent = events.find((e) => e.type === "configured");
    expect(configuredEvent).toBeDefined();
    expect(configuredEvent!.payload.model).toBe("claude-haiku-4-5");
  });

  test("does not call the Anthropic API for configure messages", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const config: AgentConfig = { ...baseConfig };
    const fakeLoadConfig = mock(async () => ({ ...baseConfig, model: "claude-haiku-4-5" }));
    const envelope = makeEnvelope({ type: "configure", payload: {} });

    await captureEmits(async () => {
      await processMessage(client, config, messages, envelope, fakeLoadConfig);
    });

    expect(client.messages.stream).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processMessage() — unknown / unrecognised type
// ---------------------------------------------------------------------------

describe("processMessage() — unknown type", () => {
  test("does not throw for an unrecognised message type", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ type: "some_future_type", payload: {} });

    let threw = false;
    try {
      await captureEmits(async () => {
        await processMessage(client, { ...baseConfig }, messages, envelope);
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("does not modify the messages array for unknown types", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "existing" }];
    const envelope = makeEnvelope({ type: "noop", payload: {} });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(messages).toHaveLength(1);
  });

  test("does not call the Anthropic API for unknown types", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ type: "unknown_event", payload: {} });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    expect(client.messages.stream).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Message envelope parsing
// ---------------------------------------------------------------------------

describe("Message envelope parsing", () => {
  test("envelope fields are correctly threaded into stream call", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const config: AgentConfig = { model: "claude-opus-4-5", system_prompt: "sys" };
    const envelope: MessageEnvelope = {
      seq: 42,
      ts: 1_700_000_000_000,
      type: "user_message",
      from: "human",
      payload: { text: "What is 2+2?" },
    };

    await captureEmits(async () => {
      await processMessage(client, config, messages, envelope);
    });

    // The text payload should be correctly extracted and forwarded
    expect(messages[0].content).toBe("What is 2+2?");
  });

  test("seq and ts fields on the envelope do not appear in the messages array", async () => {
    const client = makeMockClient();
    const messages: Anthropic.MessageParam[] = [];
    const envelope = makeEnvelope({ seq: 99, ts: 12345, type: "user_message", payload: { text: "Test" } });

    await captureEmits(async () => {
      await processMessage(client, { ...baseConfig }, messages, envelope);
    });

    for (const msg of messages) {
      expect(msg).not.toHaveProperty("seq");
      expect(msg).not.toHaveProperty("ts");
    }
  });
});
