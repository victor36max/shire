import { describe, test, expect, mock } from "bun:test";
import { OpenCodeHarness } from "./opencode-harness";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "anthropic/claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
};

type SSEEvent =
  | {
      type: "message.part.updated";
      properties: {
        part: { type: "text"; id: string; sessionID: string; messageID: string; text: string };
        delta?: string;
      };
    }
  | {
      type: "message.part.updated";
      properties: {
        part: {
          type: "tool";
          id: string;
          sessionID: string;
          messageID: string;
          callID: string;
          tool: string;
          state:
            | { status: "running"; input: Record<string, unknown>; time: { start: number } }
            | {
                status: "completed";
                input: Record<string, unknown>;
                output: string;
                title: string;
                metadata: Record<string, unknown>;
                time: { start: number; end: number };
              }
            | {
                status: "error";
                input: Record<string, unknown>;
                error: string;
                time: { start: number; end: number };
              };
        };
      };
    }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.error";
      properties: {
        sessionID?: string;
        error?: { name: string; data: { message: string } };
      };
    };

function wrapEvent(event: SSEEvent) {
  return { directory: "/workspace", payload: event };
}

function createMockClient(sessionId = "oc-sess-1") {
  const events: SSEEvent[] = [];
  let eventResolve: (() => void) | null = null;

  const client = {
    session: {
      create: mock(async () => ({ data: { id: sessionId } })),
      get: mock(async () => ({ data: { id: sessionId } })),
      abort: mock(async () => ({ data: true })),
      promptAsync: mock(async () => ({ data: undefined })),
    },
    global: {
      event: mock(async () => ({
        stream: (async function* () {
          while (true) {
            if (events.length > 0) {
              yield wrapEvent(events.shift()!);
            } else {
              await new Promise<void>((resolve) => {
                eventResolve = resolve;
              });
            }
          }
        })(),
      })),
    },
  } as unknown as OpencodeClient;

  function pushEvent(event: SSEEvent) {
    events.push(event);
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve();
    }
  }

  return { client, pushEvent };
}

function createSimpleClient(sessionId = "oc-sess-1") {
  // A simpler mock that fires events immediately via promptAsync
  const sseEvents: SSEEvent[] = [
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: "p1",
          sessionID: sessionId,
          messageID: "m1",
          text: "Hello",
        },
        delta: "Hello",
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: "p1",
          sessionID: sessionId,
          messageID: "m1",
          text: "Hello world",
        },
        delta: " world",
      },
    },
    { type: "session.idle", properties: { sessionID: sessionId } },
  ];

  let streamClosed = false;

  const client = {
    session: {
      create: mock(async () => ({ data: { id: sessionId } })),
      get: mock(async () => ({ data: { id: sessionId } })),
      abort: mock(async () => ({ data: true })),
      promptAsync: mock(async () => ({ data: undefined })),
    },
    global: {
      event: mock(async () => ({
        stream: (async function* () {
          for (const event of sseEvents) {
            if (streamClosed) return;
            yield wrapEvent(event);
          }
          // Keep alive until closed
          while (!streamClosed) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
          }
        })(),
      })),
    },
  } as unknown as OpencodeClient;

  return {
    client,
    close() {
      streamClosed = true;
    },
  };
}

describe("OpenCodeHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new OpenCodeHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("getSessionId() returns null before any message", async () => {
    const harness = new OpenCodeHarness();
    const { client } = createSimpleClient();
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    expect(harness.getSessionId()).toBeNull();
    await harness.stop();
  });

  test("getSessionId() returns session id after sendMessage", async () => {
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const { client } = createSimpleClient("oc-sess-42");
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    expect(harness.getSessionId()).toBe("oc-sess-42");
    await harness.stop();
  });

  test("start() does not create session eagerly", async () => {
    const { client } = createSimpleClient();
    const factory = mock(async () => client);
    const harness = new OpenCodeHarness();
    harness._setClientFactory(factory);
    await harness.start(baseConfig);
    expect(client.session.create).not.toHaveBeenCalled();
    await harness.stop();
  });

  test("session is created lazily on first sendMessage()", async () => {
    const { client } = createSimpleClient();
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    expect(client.session.create).toHaveBeenCalledTimes(1);
    await harness.stop();
  });

  test("session is reused across multiple sendMessage() calls", async () => {
    const { client, pushEvent } = createMockClient();
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);

    // First message — push idle after promptAsync fires
    const p1 = harness.sendMessage("Hi");
    await new Promise<void>((r) => setTimeout(r, 20));
    pushEvent({ type: "session.idle", properties: { sessionID: "oc-sess-1" } });
    await p1;

    // Second message
    const p2 = harness.sendMessage("Again");
    await new Promise<void>((r) => setTimeout(r, 20));
    pushEvent({ type: "session.idle", properties: { sessionID: "oc-sess-1" } });
    await p2;

    expect(client.session.create).toHaveBeenCalledTimes(1);
    await harness.stop();
  });

  test("sendMessage() throws if start() was not called", async () => {
    const harness = new OpenCodeHarness();
    const { client } = createSimpleClient();
    harness._setClientFactory(async () => client);
    await expect(harness.sendMessage("Hi")).rejects.toThrow("Harness not started");
  });

  test("sendMessage() maps text_delta events", async () => {
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const { client } = createSimpleClient();
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].payload.delta).toBe("Hello");
    await harness.stop();
  });

  test("sendMessage() emits text and turn_complete events", async () => {
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const { client } = createSimpleClient();
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
    await harness.stop();
  });

  test("turn_complete includes session_id", async () => {
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const { client } = createSimpleClient("oc-sess-99");
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

    const tc = events.find((e) => e.type === "turn_complete");
    expect(tc).toBeDefined();
    expect(tc!.payload.session_id).toBe("oc-sess-99");
    await harness.stop();
  });

  test("sendMessage() maps tool events", async () => {
    const sessionId = "oc-sess-1";
    const sseEvents: SSEEvent[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "p2",
            sessionID: sessionId,
            messageID: "m1",
            callID: "tc1",
            tool: "bash",
            state: {
              status: "running",
              input: { command: "ls" },
              time: { start: Date.now() },
            },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "p2",
            sessionID: sessionId,
            messageID: "m1",
            callID: "tc1",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              output: "file1.txt\nfile2.txt",
              title: "bash",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          },
        },
      },
      { type: "session.idle", properties: { sessionID: sessionId } },
    ];

    const client = {
      session: {
        create: mock(async () => ({ data: { id: sessionId } })),
        get: mock(async () => ({ data: { id: sessionId } })),
        abort: mock(async () => ({ data: true })),
        promptAsync: mock(async () => ({ data: undefined })),
      },
      global: {
        event: mock(async () => ({
          stream: (async function* () {
            for (const event of sseEvents) yield wrapEvent(event);
            // Keep alive
            await new Promise<void>(() => {});
          })(),
        })),
      },
    } as unknown as OpencodeClient;

    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("run ls");

    const toolStart = events.filter((e) => e.type === "tool_use");
    expect(toolStart).toHaveLength(1);
    expect(toolStart[0].payload.tool).toBe("bash");
    expect(toolStart[0].payload.tool_use_id).toBe("tc1");

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0].payload.tool_use_id).toBe("tc1");
    expect(toolResult[0].payload.output).toBe("file1.txt\nfile2.txt");
    expect(toolResult[0].payload.is_error).toBe(false);
    await harness.stop();
  });

  test("sendMessage() maps tool error events", async () => {
    const sessionId = "oc-sess-1";
    const sseEvents: SSEEvent[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "p2",
            sessionID: sessionId,
            messageID: "m1",
            callID: "tc2",
            tool: "bash",
            state: {
              status: "error",
              input: { command: "bad-cmd" },
              error: "command not found",
              time: { start: Date.now(), end: Date.now() },
            },
          },
        },
      },
      { type: "session.idle", properties: { sessionID: sessionId } },
    ];

    const client = {
      session: {
        create: mock(async () => ({ data: { id: sessionId } })),
        get: mock(async () => ({ data: { id: sessionId } })),
        abort: mock(async () => ({ data: true })),
        promptAsync: mock(async () => ({ data: undefined })),
      },
      global: {
        event: mock(async () => ({
          stream: (async function* () {
            for (const event of sseEvents) yield wrapEvent(event);
            await new Promise<void>(() => {});
          })(),
        })),
      },
    } as unknown as OpencodeClient;

    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("run bad-cmd");

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0].payload.is_error).toBe(true);
    expect(toolResult[0].payload.output).toBe("command not found");
    await harness.stop();
  });

  test("sendMessage() prepends agent prefix", async () => {
    const { client } = createSimpleClient();
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Some data", "researcher-bot");
    expect(client.session.promptAsync).toHaveBeenCalled();
    const call = (client.session.promptAsync as ReturnType<typeof mock>).mock.calls[0];
    const body = call[0]?.body;
    expect(body.parts[0].text).toBe('[Message from agent "researcher-bot"]\nSome data');
    await harness.stop();
  });

  test("sendMessage() emits error and turn_complete on session error event", async () => {
    const { client, pushEvent } = createMockClient();
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);

    const p = harness.sendMessage("test");
    await new Promise<void>((r) => setTimeout(r, 20));
    pushEvent({
      type: "session.error",
      properties: {
        sessionID: "oc-sess-1",
        error: { name: "UnknownError", data: { message: "Rate limit exceeded" } },
      },
    });
    await p;

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("Rate limit exceeded");
    expect(events.map((e) => e.type)).toContain("turn_complete");
    await harness.stop();
  });

  test("stop() suppresses further event emission", async () => {
    const { client, pushEvent } = createMockClient();
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.stop();
    pushEvent({
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: "p1",
          sessionID: "s1",
          messageID: "m1",
          text: "should not appear",
        },
        delta: "should not appear",
      },
    });
    // Give a tick for any event processing
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(events).toHaveLength(0);
  });

  test("interrupt() calls abort on the session", async () => {
    const { client } = createSimpleClient();
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("init");
    await harness.interrupt();
    expect(client.session.abort).toHaveBeenCalledTimes(1);
    await harness.stop();
  });

  test("clearSession() causes a new session on next sendMessage()", async () => {
    let callCount = 0;
    const events: SSEEvent[] = [];
    let eventResolve: (() => void) | null = null;

    const client = {
      session: {
        create: mock(async () => ({ data: { id: `oc-sess-${++callCount}` } })),
        get: mock(async () => ({ data: { id: `oc-sess-${callCount}` } })),
        abort: mock(async () => ({ data: true })),
        promptAsync: mock(async () => ({ data: undefined })),
      },
      global: {
        event: mock(async () => ({
          stream: (async function* () {
            while (true) {
              if (events.length > 0) {
                yield wrapEvent(events.shift()!);
              } else {
                await new Promise<void>((resolve) => {
                  eventResolve = resolve;
                });
              }
            }
          })(),
        })),
      },
    } as unknown as OpencodeClient;

    function pushEvent(event: SSEEvent) {
      events.push(event);
      if (eventResolve) {
        const resolve = eventResolve;
        eventResolve = null;
        resolve();
      }
    }

    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);

    const p1 = harness.sendMessage("First");
    await new Promise<void>((r) => setTimeout(r, 20));
    pushEvent({ type: "session.idle", properties: { sessionID: "oc-sess-1" } });
    await p1;
    expect(client.session.create).toHaveBeenCalledTimes(1);

    await harness.clearSession();
    expect(harness.getSessionId()).toBeNull();

    const p2 = harness.sendMessage("Fresh start");
    await new Promise<void>((r) => setTimeout(r, 20));
    pushEvent({ type: "session.idle", properties: { sessionID: "oc-sess-2" } });
    await p2;
    expect(client.session.create).toHaveBeenCalledTimes(2);
    await harness.stop();
  });

  test("sendMessage() after stop() is a no-op", async () => {
    const { client } = createSimpleClient();
    const harness = new OpenCodeHarness();
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.stop();
    // Should not throw, just return silently
    await harness.sendMessage("too late");
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  test("session resume uses get() with existing session id", async () => {
    const { client } = createSimpleClient("oc-sess-resume");
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start({ ...baseConfig, resume: "oc-sess-resume" });
    await harness.sendMessage("Continue");

    // Should not create a new session, should use existing
    expect(client.session.create).not.toHaveBeenCalled();
    expect(harness.getSessionId()).toBe("oc-sess-resume");
    await harness.stop();
  });

  test("text event contains accumulated text from last delta", async () => {
    const { client } = createSimpleClient();
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
    // The last text part update has text "Hello world"
    expect(textEvent!.payload.text).toBe("Hello world");
    await harness.stop();
  });

  test("sendMessage() resolves when promptAsync throws", async () => {
    const { client } = createMockClient();
    (client.session.promptAsync as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("Network failure");
    });
    const harness = new OpenCodeHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);

    // Should resolve without hanging
    await harness.sendMessage("test");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("Network failure");
    expect(events.map((e) => e.type)).toContain("turn_complete");
    await harness.stop();
  });

  test("stop() resolves in-flight sendMessage", async () => {
    const { client } = createMockClient();
    const harness = new OpenCodeHarness();
    harness.onEvent(() => {});
    harness._setClientFactory(async () => client);
    await harness.start(baseConfig);

    // Start a sendMessage that will wait for turn_complete
    const sendPromise = harness.sendMessage("long task");
    // Let it get to the waiting state
    await new Promise<void>((r) => setTimeout(r, 20));

    // Stop should resolve the pending promise
    await harness.stop();
    // sendPromise should resolve without hanging
    await sendPromise;
  });
});
