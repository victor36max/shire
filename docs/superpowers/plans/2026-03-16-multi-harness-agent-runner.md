# Multi-Harness Agent Runner Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the agent runner from direct Anthropic SDK usage to an adapter pattern supporting Pi SDK and Claude Code CLI harnesses, selectable per agent.

**Architecture:** A `Harness` TypeScript interface with two implementations (`PiHarness`, `ClaudeCodeHarness`). The existing runner delegates to the configured harness instead of calling the Anthropic SDK directly. A new `harness` field on the Agent Ecto schema drives harness selection. Both harnesses emit a unified JSONL event protocol.

**Tech Stack:** Bun + TypeScript (runner), `@mariozechner/pi-coding-agent` + `@mariozechner/pi-ai` (Pi), `claude` CLI (Claude Code), Elixir/Phoenix + Ecto (backend), React + shadcn/ui via LiveReact (frontend)

**Spec:** `docs/superpowers/specs/2026-03-16-multi-harness-agent-runner-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `priv/sprite/harness/types.ts` | Create | `Harness`, `HarnessConfig`, `AgentEvent` interfaces |
| `priv/sprite/harness/pi-harness.ts` | Create | Pi SDK adapter implementation |
| `priv/sprite/harness/claude-code-harness.ts` | Create | Claude Code CLI adapter implementation |
| `priv/sprite/harness/index.ts` | Create | `createHarness()` factory function |
| `priv/sprite/agent-runner.ts` | Modify | Refactor to use harness instead of Anthropic SDK |
| `priv/sprite/agent-runner.test.ts` | Rewrite | Test harness abstraction, not Anthropic SDK |
| `priv/sprite/package.json` | Modify | Swap deps: remove `@anthropic-ai/sdk`, add Pi SDK |
| `priv/sprite/tsconfig.json` | Modify | Include `harness/` subdirectory |
| `lib/sprite_agents/agents/agent.ex` | Modify | Add `:harness` enum field |
| `lib/sprite_agents/agent/agent_manager.ex` | Modify | Write harness to config, deploy harness files |
| `priv/repo/migrations/*_add_harness_to_agents.exs` | Create | Add `harness` column |
| `assets/react-components/AgentForm.tsx` | Modify | Add harness select dropdown |
| `assets/react-components/AgentShow.tsx` | Modify | Show harness badge |
| `assets/react-components/AgentCard.tsx` | Modify | Show harness in subtitle |
| `assets/react-components/AgentPage.tsx` | Modify | Add `harness` to Agent interface and `handleEdit` |
| `assets/test/AgentShow.test.tsx` | Modify | Add harness badge test |

---

## Chunk 1: Harness Interface & Factory

### Task 1: Harness types and factory

**Files:**
- Create: `priv/sprite/harness/types.ts`
- Create: `priv/sprite/harness/index.ts`
- Test: `priv/sprite/agent-runner.test.ts` (add factory tests)

- [ ] **Step 1: Create `harness/types.ts` with interfaces**

```typescript
// priv/sprite/harness/types.ts
export interface HarnessConfig {
  model: string;
  systemPrompt: string;
  cwd: string;
  maxTokens?: number;
}

export interface AgentEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type EventCallback = (event: AgentEvent) => void;

export interface Harness {
  start(config: HarnessConfig): Promise<void>;
  sendMessage(text: string, from?: string): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onEvent(callback: EventCallback): void;
  isProcessing(): boolean;
}
```

- [ ] **Step 2: Create `harness/index.ts` factory**

```typescript
// priv/sprite/harness/index.ts
import type { Harness } from "./types";
import { PiHarness } from "./pi-harness";
import { ClaudeCodeHarness } from "./claude-code-harness";

export { type Harness, type HarnessConfig, type AgentEvent, type EventCallback } from "./types";

export function createHarness(type: string): Harness {
  switch (type) {
    case "pi":
      return new PiHarness();
    case "claude_code":
      return new ClaudeCodeHarness();
    default:
      throw new Error(`Unknown harness type: ${type}`);
  }
}
```

- [ ] **Step 3: Update `tsconfig.json` to include `harness/` files**

Change `"include": ["*.ts"]` to `"include": ["*.ts", "harness/**/*.ts"]` in `priv/sprite/tsconfig.json`.

- [ ] **Step 4: Write factory tests**

Add to the top of `priv/sprite/agent-runner.test.ts` (these will be the first tests in the rewritten file; we'll remove old tests later):

```typescript
// At the top of the test file, add:
import { createHarness } from "./harness";

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
```

- [ ] **Step 5: Run tests to verify factory tests fail**

Run: `cd priv/sprite && bun test agent-runner.test.ts`
Expected: FAIL — PiHarness and ClaudeCodeHarness modules don't exist yet. The "throws on unknown" test should pass.

- [ ] **Step 6: Create stub harness implementations**

Create `priv/sprite/harness/pi-harness.ts`:

```typescript
import type { Harness, HarnessConfig, EventCallback } from "./types";

export class PiHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;

  async start(_config: HarnessConfig): Promise<void> {
    // TODO: implement in Task 2
  }

  async sendMessage(_text: string, _from?: string): Promise<void> {
    // TODO: implement in Task 2
  }

  async interrupt(): Promise<void> {
    // TODO: implement in Task 2
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
```

Create `priv/sprite/harness/claude-code-harness.ts`:

```typescript
import type { Harness, HarnessConfig, EventCallback } from "./types";

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;

  async start(_config: HarnessConfig): Promise<void> {
    // TODO: implement in Task 3
  }

  async sendMessage(_text: string, _from?: string): Promise<void> {
    // TODO: implement in Task 3
  }

  async interrupt(): Promise<void> {
    // TODO: implement in Task 3
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
```

- [ ] **Step 7: Run tests to verify factory tests pass**

Run: `cd priv/sprite && bun test agent-runner.test.ts`
Expected: All 3 factory tests PASS. Old tests may still pass (they use the old Anthropic mock pattern).

- [ ] **Step 8: Commit**

```bash
git add priv/sprite/harness/ priv/sprite/tsconfig.json priv/sprite/agent-runner.test.ts
git commit -m "feat: add harness interface, types, and factory with stub implementations"
```

---

## Chunk 2: PiHarness Implementation

### Task 2: Implement PiHarness

**Files:**
- Modify: `priv/sprite/harness/pi-harness.ts`
- Modify: `priv/sprite/package.json`
- Create: `priv/sprite/harness/pi-harness.test.ts`

- [ ] **Step 1: Update `package.json` dependencies**

Replace `@anthropic-ai/sdk` with Pi SDK packages:

```json
{
  "name": "sprite-agent-runner",
  "private": true,
  "type": "module",
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-ai": "latest"
  },
  "devDependencies": {
    "bun-types": "^1.3.10"
  }
}
```

- [ ] **Step 2: Run `bun install` to install Pi SDK**

Run: `cd priv/sprite && bun install`
Expected: Packages install successfully.

- [ ] **Step 3: Write PiHarness tests**

Create `priv/sprite/harness/pi-harness.test.ts`:

```typescript
import { describe, test, expect, mock, spyOn, beforeEach } from "bun:test";
import { PiHarness } from "./pi-harness";
import type { AgentEvent, HarnessConfig } from "./types";

const baseConfig: HarnessConfig = {
  model: "anthropic/claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  cwd: "/workspace",
  maxTokens: 4096,
};

// Mock session that records calls and can fire events
function createMockSession() {
  let subscriber: ((event: any) => void) | null = null;

  const session = {
    subscribe: mock((cb: (event: any) => void) => {
      subscriber = cb;
    }),
    prompt: mock(async (_text: string) => {
      // Simulate firing events
      if (subscriber) {
        subscriber({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello" },
        });
        subscriber({
          type: "message_end",
          message: { content: [{ type: "text", text: "Hello world" }] },
        });
        subscriber({ type: "agent_end" });
      }
    }),
    fireEvent: (event: any) => {
      if (subscriber) subscriber(event);
    },
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
    // start() will attempt to load Pi SDK — we test the mock path
    // For unit tests, we inject a mock session creator
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
      mockSession.fireEvent({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "tc1",
      });
      mockSession.fireEvent({
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "tc1",
        result: { content: [{ type: "text", text: "done" }] },
      });
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

    expect(mockSession.prompt).toHaveBeenCalledWith(
      '[Message from agent "researcher-bot"]\nSome data'
    );
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
    mockSession.prompt = mock(async () => {
      throw new Error("Rate limit exceeded");
    });

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

    // Manually fire an event after stop — should be suppressed
    mockSession.fireEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "should not appear" },
    });

    expect(events).toHaveLength(0);
  });

  test("interrupt() resets session", async () => {
    const harness = new PiHarness();
    let sessionCount = 0;

    harness._setSessionFactory(async () => {
      sessionCount++;
      return createMockSession() as any;
    });
    await harness.start(baseConfig);
    expect(sessionCount).toBe(1);

    await harness.interrupt();
    expect(sessionCount).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd priv/sprite && bun test harness/pi-harness.test.ts`
Expected: FAIL — `_setSessionFactory` doesn't exist yet, `start` doesn't create sessions.

- [ ] **Step 5: Implement PiHarness**

Replace the stub in `priv/sprite/harness/pi-harness.ts`:

```typescript
import type { Harness, HarnessConfig, EventCallback } from "./types";

type SessionLike = {
  subscribe: (cb: (event: any) => void) => void;
  prompt: (text: string) => Promise<void>;
};

type SessionFactory = (config: HarnessConfig) => Promise<SessionLike>;

export class PiHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private session: SessionLike | null = null;
  private config: HarnessConfig | null = null;
  private sessionFactory: SessionFactory | null = null;

  /** For testing: inject a mock session factory */
  _setSessionFactory(factory: SessionFactory): void {
    this.sessionFactory = factory;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.session = await this.createSession(config);
    this.subscribeToSession(this.session);
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.session) throw new Error("Harness not started");

    const content = from
      ? `[Message from agent "${from}"]\n${text}`
      : text;

    this.processing = true;
    try {
      await this.session.prompt(content);
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
    } finally {
      this.processing = false;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.config) return;
    this.session = await this.createSession(this.config);
    this.subscribeToSession(this.session);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.session = null;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private async createSession(config: HarnessConfig): Promise<SessionLike> {
    if (this.sessionFactory) {
      return this.sessionFactory(config);
    }

    // Real Pi SDK initialization
    const { createAgentSession, AuthStorage, ModelRegistry, createCodingTools, SessionManager, SettingsManager, DefaultResourceLoader } = await import("@mariozechner/pi-coding-agent");
    const { getModel } = await import("@mariozechner/pi-ai");

    const authStorage = AuthStorage.create();
    if (process.env.ANTHROPIC_API_KEY) {
      authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
    }

    const modelRegistry = new ModelRegistry(authStorage);
    const [provider, modelName] = config.model.split("/");
    const model = getModel(provider, modelName);
    if (!model) throw new Error(`Model not found: ${config.model}`);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    const loader = new DefaultResourceLoader({
      cwd: config.cwd,
      settingsManager,
      systemPromptOverride: () => config.systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: config.cwd,
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      tools: createCodingTools(config.cwd),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });

    return session;
  }

  private subscribeToSession(session: SessionLike): void {
    session.subscribe((event: any) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            this.emitEvent({ type: "text_delta", payload: { delta: event.assistantMessageEvent.delta } });
          }
          break;
        case "message_end": {
          const text = (event.message?.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          this.emitEvent({ type: "text", payload: { text } });
          break;
        }
        case "tool_execution_start":
          this.emitEvent({ type: "tool_use", payload: { tool: event.toolName, status: "started" } });
          break;
        case "tool_execution_end":
          this.emitEvent({ type: "tool_use", payload: { tool: event.toolName, status: "completed", result: event.result } });
          break;
        case "agent_end":
          this.emitEvent({ type: "turn_complete", payload: {} });
          break;
      }
    });
  }

  private emitEvent(event: { type: string; payload: Record<string, unknown> }): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd priv/sprite && bun test harness/pi-harness.test.ts`
Expected: All 9 PiHarness tests PASS.

- [ ] **Step 7: Commit**

```bash
git add priv/sprite/harness/pi-harness.ts priv/sprite/harness/pi-harness.test.ts priv/sprite/package.json
git commit -m "feat: implement PiHarness with Pi SDK integration"
```

---

### Task 3: Implement ClaudeCodeHarness

**Files:**
- Modify: `priv/sprite/harness/claude-code-harness.ts`
- Create: `priv/sprite/harness/claude-code-harness.test.ts`

- [ ] **Step 1: Write ClaudeCodeHarness tests**

Create `priv/sprite/harness/claude-code-harness.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
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
  return mock((_cmd: string[], _opts: any) => {
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
    const spawner = createMockSpawner([
      '{"type":"result","subtype":"success","result":"Hi","session_id":"s1"}',
    ]);
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
    const spawner = createMockSpawner([
      '{"type":"result","subtype":"success","result":"Hi","session_id":"sess-123"}',
    ]);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("First message");

    // Second call should include --resume
    spawner.mockImplementation(createMockSpawner([
      '{"type":"result","subtype":"success","result":"Ok","session_id":"sess-123"}',
    ]));
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
    const spawner = mock((_cmd: string[], _opts: any) => ({
      stdout: new ReadableStream({
        start(controller) { controller.close(); },
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
    const spawner = createMockSpawner([
      '{"type":"result","subtype":"success","result":"Hi","session_id":"sess-abc"}',
    ]);
    const harness = new ClaudeCodeHarness();
    harness._setSpawner(spawner);
    harness.onEvent(() => {});

    await harness.start(baseConfig);
    await harness.sendMessage("First");
    await harness.interrupt();

    // Next call should NOT include --resume
    spawner.mockImplementation(createMockSpawner([
      '{"type":"result","subtype":"success","result":"Fresh","session_id":"sess-new"}',
    ]));
    await harness.sendMessage("After interrupt");

    const [cmd] = spawner.mock.calls[spawner.mock.calls.length - 1];
    expect(cmd).not.toContain("--resume");
  });

  test("isProcessing() tracks subprocess lifecycle", async () => {
    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>((r) => { resolveExit = r; });

    const spawner = mock((_cmd: string[], _opts: any) => ({
      stdout: new ReadableStream({
        start(controller) { controller.close(); },
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
    const spawner = createMockSpawner([
      '{"type":"result","subtype":"success","result":"Hi","session_id":"s1"}',
    ]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd priv/sprite && bun test harness/claude-code-harness.test.ts`
Expected: FAIL — `_setSpawner` and implementation don't exist yet.

- [ ] **Step 3: Implement ClaudeCodeHarness**

Replace the stub in `priv/sprite/harness/claude-code-harness.ts`:

```typescript
import type { Harness, HarnessConfig, EventCallback } from "./types";

type SpawnResult = {
  stdout: ReadableStream;
  exited: Promise<number>;
  kill: (signal?: number) => void;
};

type Spawner = (cmd: string[], opts: any) => SpawnResult;

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
  private sessionId: string | null = null;
  private activeProc: SpawnResult | null = null;
  private spawner: Spawner | null = null;

  /** For testing: inject a mock spawner */
  _setSpawner(spawner: Spawner): void {
    this.spawner = spawner;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    const content = from
      ? `[Message from agent "${from}"]\n${text}`
      : text;

    const args = [
      "claude",
      "-p", content,
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--allowedTools", "Bash,Read,Edit,Write",
      "--model", this.config.model,
    ];

    if (this.config.systemPrompt) {
      args.push("--append-system-prompt", this.config.systemPrompt);
    }

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    this.processing = true;
    try {
      const spawn = this.spawner || ((cmd: string[], opts: any) =>
        Bun.spawn(cmd, opts) as unknown as SpawnResult
      );

      const proc = spawn(args, {
        cwd: this.config.cwd,
        env: process.env,
        stdout: "pipe",
      });
      this.activeProc = proc;

      // Read stdout as text stream
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          this.parseLine(line);
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        this.parseLine(buffer);
      }

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        this.emitEvent({ type: "error", payload: { message: `Claude CLI exit code ${exitCode}` } });
      }
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
    } finally {
      this.processing = false;
      this.activeProc = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.activeProc) {
      this.activeProc.kill();
      this.activeProc = null;
    }
    this.sessionId = null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.activeProc) {
      this.activeProc.kill();
      this.activeProc = null;
    }
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private parseLine(line: string): void {
    try {
      const obj = JSON.parse(line);

      if (obj.type === "system" && obj.session_id) {
        this.sessionId = obj.session_id;
      }

      if (obj.type === "stream_event") {
        const delta = obj.event?.delta;
        if (delta?.type === "text_delta") {
          this.emitEvent({ type: "text_delta", payload: { delta: delta.text } });
        }
        if (obj.event?.type === "content_block_start" && obj.event?.content_block?.type === "tool_use") {
          this.emitEvent({ type: "tool_use", payload: { tool: obj.event.content_block.name, status: "started" } });
        }
      }

      if (obj.type === "result") {
        this.emitEvent({ type: "text", payload: { text: obj.result } });
        this.emitEvent({ type: "turn_complete", payload: {} });
        if (obj.session_id) this.sessionId = obj.session_id;
      }
    } catch {
      // Skip unparseable lines
    }
  }

  private emitEvent(event: { type: string; payload: Record<string, unknown> }): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd priv/sprite && bun test harness/claude-code-harness.test.ts`
Expected: All 11 ClaudeCodeHarness tests PASS.

- [ ] **Step 5: Commit**

```bash
git add priv/sprite/harness/claude-code-harness.ts priv/sprite/harness/claude-code-harness.test.ts
git commit -m "feat: implement ClaudeCodeHarness with Claude CLI integration"
```

---

## Chunk 3: Refactor Agent Runner & Update Existing Tests

### Task 4: Refactor agent-runner.ts

**Files:**
- Modify: `priv/sprite/agent-runner.ts`
- Rewrite: `priv/sprite/agent-runner.test.ts`

- [ ] **Step 1: Rewrite `agent-runner.ts` to use harness**

The current file directly uses `@anthropic-ai/sdk`. Replace with harness delegation. Key changes:

1. Remove `import Anthropic` and all Anthropic SDK usage
2. Add `import { createHarness } from "./harness"`
3. Add `harness` field to `AgentConfig` interface
4. Refactor `processMessage()` to delegate to harness
5. Keep `emit()`, `loadConfig()`, `processInbox()`, `main()` structure

Replace `priv/sprite/agent-runner.ts` with:

```typescript
// agent-runner.ts — Bun daemon that watches the inbox and dispatches to configured harness.
import { watch } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import { createHarness, type Harness } from "./harness";

const INBOX_DIR = "/workspace/mailbox/inbox";
const CONFIG_PATH = "/workspace/agent-config.json";

export interface AgentConfig {
  harness: string;
  model: string;
  system_prompt: string;
  max_tokens?: number;
}

export interface MessageEnvelope {
  seq: number;
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

export function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
}

export async function loadConfig(path = CONFIG_PATH): Promise<AgentConfig> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

export async function processMessage(
  harness: Harness,
  config: AgentConfig,
  envelope: MessageEnvelope,
  loadConfigFn: () => Promise<AgentConfig> = loadConfig
): Promise<{ harness: Harness; config: AgentConfig }> {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
    const text = envelope.payload.text as string;
    const from = envelope.type === "agent_message" ? envelope.from : undefined;
    await harness.sendMessage(text, from);
  } else if (envelope.type === "interrupt") {
    await harness.interrupt();
    emit("interrupted", {});
  } else if (envelope.type === "shutdown") {
    await harness.stop();
    emit("shutdown", {});
    process.exit(0);
  } else if (envelope.type === "configure") {
    await harness.stop();
    const newConfig = await loadConfigFn();
    Object.assign(config, newConfig);
    const newHarness = createHarness(config.harness);
    newHarness.onEvent((event) => emit(event.type, event.payload));
    await newHarness.start({
      model: config.model,
      systemPrompt: config.system_prompt,
      cwd: "/workspace",
      maxTokens: config.max_tokens,
    });
    emit("configured", { model: config.model });
    return { harness: newHarness, config };
  }

  return { harness, config };
}

export async function processInbox(
  harness: Harness,
  config: AgentConfig
): Promise<{ harness: Harness; config: AgentConfig }> {
  const files = await readdir(INBOX_DIR);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  let currentHarness = harness;
  let currentConfig = config;

  for (const file of sorted) {
    const path = join(INBOX_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope: MessageEnvelope = JSON.parse(raw);
      const result = await processMessage(currentHarness, currentConfig, envelope);
      currentHarness = result.harness;
      currentConfig = result.config;
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
    }
  }

  return { harness: currentHarness, config: currentConfig };
}

async function main() {
  const config = await loadConfig();
  let harness = createHarness(config.harness);

  harness.onEvent((event) => emit(event.type, event.payload));
  await harness.start({
    model: config.model,
    systemPrompt: config.system_prompt,
    cwd: "/workspace",
    maxTokens: config.max_tokens,
  });

  emit("ready", { model: config.model, harness: config.harness });

  let processing = false;

  // Process any existing inbox messages
  const result = await processInbox(harness, config);
  harness = result.harness;

  // Watch for new messages
  const watcher = watch(INBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".json") || processing) return;
    processing = true;
    try {
      const result = await processInbox(harness, config);
      harness = result.harness;
    } finally {
      processing = false;
    }
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive" });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    watcher.close();
    harness.stop();
    emit("shutdown", {});
    process.exit(0);
  });
}

if (import.meta.main) {
  main().catch((err) => {
    emit("error", { message: `Fatal: ${err}` });
    process.exit(1);
  });
}
```

- [ ] **Step 2: Rewrite `agent-runner.test.ts`**

Replace the entire file. Tests now use mock harness instead of mock Anthropic client:

```typescript
// agent-runner.test.ts — Tests for agent-runner with harness abstraction.
import { describe, test, expect, mock, spyOn } from "bun:test";
import { emit, processMessage, type AgentConfig, type MessageEnvelope } from "./agent-runner";
import type { Harness, HarnessConfig, EventCallback } from "./harness";
import { createHarness } from "./harness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

    let result: any;
    await captureEmits(async () => {
      result = await processMessage(harness, config, envelope, fakeLoadConfig);
    });

    // The returned harness should be different from the original mock
    expect(result.harness).not.toBe(harness);
    expect(result.harness.start).toBeInstanceOf(Function);
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

    // Mock process.exit to prevent actual exit
    const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("EXIT"); });

    let events: any[] = [];
    try {
      events = await captureEmits(async () => {
        await processMessage(harness, { ...baseConfig }, envelope);
      });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      exitSpy.mockRestore();
    }

    expect(harness.stop).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("shutdown");
    expect(exitSpy).toHaveBeenCalledWith(0);
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
```

- [ ] **Step 3: Run all TypeScript tests**

Run: `cd priv/sprite && bun test`
Expected: All tests pass — agent-runner.test.ts, pi-harness.test.ts, claude-code-harness.test.ts.

- [ ] **Step 4: Run TypeScript type check**

Run: `cd priv/sprite && bun run tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add priv/sprite/agent-runner.ts priv/sprite/agent-runner.test.ts
git commit -m "refactor: replace Anthropic SDK with harness adapter pattern in agent runner"
```

---

## Chunk 4: Elixir Schema, Migration, AgentManager & UI

### Task 5: Add harness field to Agent schema and migration

**Files:**
- Create: `priv/repo/migrations/TIMESTAMP_add_harness_to_agents.exs`
- Modify: `lib/sprite_agents/agents/agent.ex`
- Modify: `test/sprite_agents/agents_test.exs` (if exists, or inline verification)

- [ ] **Step 1: Generate migration timestamp and create migration**

Run: `cd /Users/victor/Documents/sprite-agents && mix ecto.gen.migration add_harness_to_agents`

Then edit the generated file to contain:

```elixir
defmodule SpriteAgents.Repo.Migrations.AddHarnessToAgents do
  use Ecto.Migration

  def change do
    alter table(:agents) do
      add :harness, :string, default: "pi", null: false
    end
  end
end
```

- [ ] **Step 2: Add `:harness` field to Agent schema**

In `lib/sprite_agents/agents/agent.ex`, add the field after `:status`:

```elixir
field :harness, Ecto.Enum,
  values: [:pi, :claude_code],
  default: :pi
```

And add `:harness` to the `cast/3` call:

```elixir
|> cast(attrs, [:name, :sprite_name, :status, :model, :system_prompt, :harness])
```

- [ ] **Step 3: Run migration**

Run: `mix ecto.migrate`
Expected: Migration runs successfully.

- [ ] **Step 4: Verify schema works**

Run: `mix test test/sprite_agents/agents_test.exs`
Expected: Existing agent tests still pass. The harness field defaults to `:pi`.

- [ ] **Step 5: Commit**

```bash
git add priv/repo/migrations/*_add_harness_to_agents.exs lib/sprite_agents/agents/agent.ex
git commit -m "feat: add harness enum field to Agent schema"
```

---

### Task 6: Update AgentManager to deploy harness files and write harness config

**Files:**
- Modify: `lib/sprite_agents/agent/agent_manager.ex`

- [ ] **Step 1: Update config generation in `handle_continue(:bootstrap, state)`**

In `lib/sprite_agents/agent/agent_manager.ex`, find the config generation block (around line 107) and replace:

```elixir
# Old:
config =
  Jason.encode!(%{
    model: agent.model || "claude-sonnet-4-6",
    system_prompt: agent.system_prompt || "You are a helpful assistant.",
    max_tokens: 4096
  })
```

With:

```elixir
default_model = case agent.harness do
  :claude_code -> "claude-sonnet-4-6"
  _ -> "anthropic/claude-sonnet-4-6"
end

config =
  Jason.encode!(%{
    harness: agent.harness || "pi",
    model: agent.model || default_model,
    system_prompt: agent.system_prompt || "You are a helpful assistant.",
    max_tokens: 4096
  })
```

- [ ] **Step 2: Update file deployment to include harness directory**

In the same `handle_continue(:bootstrap, state)`, replace the single-file deployment:

```elixir
# Old:
runner_source =
  File.read!(Application.app_dir(:sprite_agents, "priv/sprite/agent-runner.ts"))
Sprites.Filesystem.write(fs, "/workspace/agent-runner.ts", runner_source)
```

With:

```elixir
# Deploy all TypeScript source files
ts_files = [
  "agent-runner.ts",
  "harness/types.ts",
  "harness/pi-harness.ts",
  "harness/claude-code-harness.ts",
  "harness/index.ts"
]

for file <- ts_files do
  source = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/#{file}"))
  # Ensure harness subdirectory exists
  if String.contains?(file, "/") do
    dir = Path.dirname("/workspace/#{file}")
    Sprites.cmd(sprite, "mkdir", ["-p", dir])
  end
  Sprites.Filesystem.write(fs, "/workspace/#{file}", source)
end
```

- [ ] **Step 3: Verify compilation**

Run: `mix compile --warnings-as-errors`
Expected: Compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add lib/sprite_agents/agent/agent_manager.ex
git commit -m "feat: update AgentManager to deploy harness files and write harness config"
```

---

### Task 7: Update UI components

**Files:**
- Modify: `assets/react-components/AgentForm.tsx`
- Modify: `assets/react-components/AgentShow.tsx`
- Modify: `assets/react-components/AgentCard.tsx`
- Modify: `assets/test/AgentShow.test.tsx`

- [ ] **Step 1: Update AgentForm to include harness select**

In `assets/react-components/AgentForm.tsx`:

Add to the `AgentFormProps` interface:
```typescript
agent: { name?: string; model?: string; system_prompt?: string; harness?: string } | null;
```

Add state for harness after existing state declarations:
```typescript
const [harness, setHarness] = React.useState(agent?.harness || "pi");
```

Add to the `useEffect`:
```typescript
setHarness(agent?.harness || "pi");
```

Update `handleSubmit` to include harness:
```typescript
pushEvent("save", {
  agent: { name, model, system_prompt: systemPrompt, harness },
});
```

Add the harness select field before the model input:
```tsx
<div className="space-y-2">
  <Label htmlFor="harness">Harness</Label>
  <select
    id="harness"
    value={harness}
    onChange={(e) => setHarness(e.target.value)}
    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  >
    <option value="pi">Pi</option>
    <option value="claude_code">Claude Code</option>
  </select>
</div>
```

- [ ] **Step 2: Update AgentShow to display harness badge**

In `assets/react-components/AgentShow.tsx`:

Add `harness` to the `Agent` interface:
```typescript
interface Agent {
  id: number;
  name: string;
  status: string;
  model: string | null;
  system_prompt: string | null;
  harness: string | null;
}
```

Add a harness row in the detail card, after the Model row:
```tsx
<div className="py-3 grid grid-cols-3 gap-4">
  <dt className="text-sm font-medium text-muted-foreground">Harness</dt>
  <dd className="text-sm col-span-2">
    <Badge variant="outline">
      {agent.harness === "claude_code" ? "Claude Code" : "Pi"}
    </Badge>
  </dd>
</div>
```

- [ ] **Step 3: Update AgentCard to show harness**

In `assets/react-components/AgentCard.tsx`:

Add `harness` to the `Agent` interface:
```typescript
harness: string | null;
```

Update the model display in `CardContent` to include harness:
```tsx
<p className="text-sm text-muted-foreground">
  {agent.harness === "claude_code" ? "Claude Code" : "Pi"}
  {agent.model ? ` · ${agent.model}` : ""}
</p>
```

- [ ] **Step 4: Update AgentPage.tsx to include harness**

In `assets/react-components/AgentPage.tsx`:

Add `harness` to the `Agent` interface (line 17-23):
```typescript
interface Agent {
  id: number;
  name: string;
  status: string;
  model: string | null;
  system_prompt: string | null;
  harness: string | null;
}
```

Add `harness` to the `editAgent` prop type (line 27):
```typescript
editAgent: { id?: number; name?: string; model?: string; system_prompt?: string; harness?: string } | null;
```

Update `handleEdit` (line 55-61) to include `harness`:
```typescript
const handleEdit = (e: React.MouseEvent, agent: Agent) => {
  e.stopPropagation();
  setCurrentAgent({
    name: agent.name,
    model: agent.model ?? "",
    system_prompt: agent.system_prompt ?? "",
    harness: agent.harness ?? "pi",
  });
  setEditingId(agent.id);
  setFormTitle("Edit Agent");
  setFormOpen(true);
};
```

- [ ] **Step 5: Add harness test to AgentShow.test.tsx**

Add to `assets/test/AgentShow.test.tsx`:

Update the agent fixture to include harness:
```typescript
const agent = {
  id: 1,
  name: "Test Agent",
  status: "active",
  model: "claude-sonnet-4-6",
  system_prompt: "You are a helpful assistant.",
  harness: "pi",
};
```

Add tests:
```typescript
it("displays harness badge", () => {
  render(<AgentShow agent={agent} pushEvent={vi.fn()} />);
  expect(screen.getByText("Pi")).toBeInTheDocument();
});

it("displays Claude Code harness", () => {
  render(
    <AgentShow agent={{ ...agent, harness: "claude_code" }} pushEvent={vi.fn()} />
  );
  expect(screen.getByText("Claude Code")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run frontend tests**

Run: `cd assets && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add assets/react-components/AgentForm.tsx assets/react-components/AgentShow.tsx assets/react-components/AgentCard.tsx assets/react-components/AgentPage.tsx assets/test/AgentShow.test.tsx
git commit -m "feat: add harness selection to agent form and display in show/card"
```

---

### Task 8: Update LiveView to pass harness field

**Files:**
- Modify: `lib/sprite_agents_web/live/agent_live/show.ex`

- [ ] **Step 1: Verify serialize_agent includes harness**

Check `lib/sprite_agents_web/live/agent_live/show.ex` — the `serialize_agent/1` function uses `Map.from_struct()` and `Map.drop([:__meta__, :secrets])`. Since `:harness` is not in the drop list, it will be included automatically. No change needed here.

- [ ] **Step 2: Check that the form LiveView passes harness in save handler**

Check the LiveView that handles "save" events (likely `lib/sprite_agents_web/live/agent_live/index.ex` or a form component). Ensure that `harness` is included in the permitted params being passed to `Agents.create_agent/1` or `Agents.update_agent/2`. Since these functions use `changeset/2` which now casts `:harness`, the form params just need to pass through.

If the LiveView save handler extracts specific fields, add `:harness`. If it passes params through directly, no change needed.

- [ ] **Step 3: Run full test suite**

Run: `mix test && cd assets && npx vitest run && cd ../priv/sprite && bun test`
Expected: All Elixir, Vitest, and Bun tests pass.

- [ ] **Step 4: Run compilation check**

Run: `mix compile --warnings-as-errors && mix format --check-formatted`
Expected: Clean compilation, no format issues.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire harness field through LiveView serialization"
```

---

## Verification Checklist

After all tasks:

1. `mix compile --warnings-as-errors` — clean
2. `mix format --check-formatted` — clean
3. `mix test` — all Elixir tests pass
4. `cd assets && npx vitest run` — all frontend tests pass
5. `cd priv/sprite && bun test` — all TypeScript tests pass
6. `cd priv/sprite && bun run tsc --noEmit` — no type errors
7. Create an agent via UI with harness="pi" — verify config JSON includes harness
8. Create an agent via UI with harness="claude_code" — verify correct default model
