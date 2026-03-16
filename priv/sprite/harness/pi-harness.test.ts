import { describe, test, expect, mock, spyOn, beforeEach } from "bun:test";
import { PiHarness } from "./pi-harness";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "anthropic/claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
  maxTokens: 4096,
};

function createMockSession() {
  let subscriber: ((event: any) => void) | null = null;
  const session = {
    subscribe: mock((cb: (event: any) => void) => { subscriber = cb; }),
    prompt: mock(async (_text: string) => {
      if (subscriber) {
        subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
        subscriber({ type: "message_end", message: { content: [{ type: "text", text: "Hello world" }] } });
        subscriber({ type: "agent_end" });
      }
    }),
    fireEvent: (event: any) => { if (subscriber) subscriber(event); },
  };
  return session;
}

describe("PiHarness", () => {
  test("isProcessing() returns false initially", () => {
    const harness = new PiHarness();
    expect(harness.isProcessing()).toBe(false);
  });

  test("start() initializes without throwing", async () => {
    const harness = new PiHarness();
    harness._setSessionFactory(async () => createMockSession() as any);
    await harness.start(baseConfig);
  });

  test("sendMessage() maps text_delta events correctly", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession() as any);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi there");
    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].payload.delta).toBe("Hello");
  });

  test("sendMessage() emits text and turn_complete events", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    harness._setSessionFactory(async () => createMockSession() as any);
    await harness.start(baseConfig);
    await harness.sendMessage("Hi");
    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("turn_complete");
    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent?.payload.text).toBe("Hello world");
  });

  test("sendMessage() maps tool events", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      mockSession.fireEvent({ type: "tool_execution_start", toolName: "bash", toolCallId: "tc1" });
      mockSession.fireEvent({ type: "tool_execution_end", toolName: "bash", toolCallId: "tc1", result: { content: [{ type: "text", text: "done" }] } });
      mockSession.fireEvent({ type: "agent_end" });
    });
    harness._setSessionFactory(async () => mockSession as any);
    await harness.start(baseConfig);
    await harness.sendMessage("run ls");
    const toolEvents = events.filter((e) => e.type === "tool_use");
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].payload.status).toBe("started");
    expect(toolEvents[0].payload.tool).toBe("bash");
    expect(toolEvents[1].payload.status).toBe("completed");
  });

  test("sendMessage() prepends agent prefix for agent messages", async () => {
    const harness = new PiHarness();
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession as any);
    await harness.start(baseConfig);
    await harness.sendMessage("Some data", "researcher-bot");
    expect(mockSession.prompt).toHaveBeenCalledWith('[Message from agent "researcher-bot"]\nSome data');
  });

  test("isProcessing() returns true during sendMessage()", async () => {
    const harness = new PiHarness();
    let processingDuringCall = false;
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => {
      processingDuringCall = harness.isProcessing();
      mockSession.fireEvent({ type: "agent_end" });
    });
    harness._setSessionFactory(async () => mockSession as any);
    await harness.start(baseConfig);
    await harness.sendMessage("test");
    expect(processingDuringCall).toBe(true);
    expect(harness.isProcessing()).toBe(false);
  });

  test("sendMessage() emits error event on SDK failure", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    mockSession.prompt = mock(async () => { throw new Error("Rate limit exceeded"); });
    harness._setSessionFactory(async () => mockSession as any);
    await harness.start(baseConfig);
    await harness.sendMessage("test");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent!.payload.message)).toContain("Rate limit exceeded");
  });

  test("stop() suppresses further event emission", async () => {
    const harness = new PiHarness();
    const events: AgentEvent[] = [];
    harness.onEvent((e) => events.push(e));
    const mockSession = createMockSession();
    harness._setSessionFactory(async () => mockSession as any);
    await harness.start(baseConfig);
    await harness.stop();
    mockSession.fireEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "should not appear" } });
    expect(events).toHaveLength(0);
  });

  test("interrupt() resets session", async () => {
    const harness = new PiHarness();
    let sessionCount = 0;
    harness._setSessionFactory(async () => { sessionCount++; return createMockSession() as any; });
    await harness.start(baseConfig);
    expect(sessionCount).toBe(1);
    await harness.interrupt();
    expect(sessionCount).toBe(2);
  });
});
