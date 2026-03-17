# Multi-Harness Agent Runner Design

## Goal

Refactor the agent runner to support multiple agent harnesses (Pi, Claude Code) via an adapter pattern, replacing the current direct Anthropic SDK approach. Each agent chooses its harness via a per-agent DB field.

## Architecture

The agent runner uses an adapter pattern: a common `Harness` interface with two implementations (`PiHarness`, `ClaudeCodeHarness`). The runner entry point handles inbox watching and JSONL stdout emission, delegating agent interaction to the configured harness. On the Elixir side, a new `harness` enum field on the Agent schema drives which harness config is written to the Sprite VM.

## Tech Stack

- **Pi harness:** `@mariozechner/pi-coding-agent` SDK (TypeScript, embedded)
- **Claude Code harness:** `claude` CLI (pre-installed on Sprite VMs), spawned as subprocess
- **Runner:** Bun + TypeScript (unchanged)
- **Backend:** Elixir/Phoenix + Ecto (migration for new field)
- **Frontend:** React + shadcn/ui via LiveReact (form update)

---

## 1. Harness Interface

A `Harness` interface defines the contract that both implementations fulfill:

```typescript
interface HarnessConfig {
  model: string;
  systemPrompt: string;
  cwd: string;
  maxTokens?: number;
}

interface AgentEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface Harness {
  start(config: HarnessConfig): Promise<void>;
  sendMessage(text: string, from?: string): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onEvent(callback: (event: AgentEvent) => void): void;
  isProcessing(): boolean;
}
```

**Concurrency:** `sendMessage()` is async and the runner must `await` it before processing the next inbox message. The `isProcessing()` method lets the runner guard against concurrent calls (same pattern as the current `processing` boolean). The runner's `processInbox` loop already serializes messages; this method is a safety check.

**Lifecycle:** `stop()` must suppress all further event emission via the `onEvent` callback. After `stop()`, the harness instance should not be reused — create a new one via `createHarness()`.

**Configure behavior:** On `configure` envelope, the runner tears down the current harness (`stop()`) and creates a new one. This intentionally resets conversation state. This is acceptable because configure is a rare operation (config file change), and preserving conversation across a potential harness or model switch would be error-prone.

**Shutdown:** The `shutdown` envelope is handled by the runner (not the harness): it calls `harness.stop()`, emits `shutdown`, and exits the process.

```text
(interface definition above)
```

### Unified Event Types

Both harnesses emit the same event types to stdout via the existing JSONL protocol:

| Event | Payload | Description |
|-------|---------|-------------|
| `text_delta` | `{ delta: string }` | Streaming text chunk |
| `text` | `{ text: string }` | Complete response text |
| `tool_use` | `{ tool: string, status: "started" \| "completed", result?: unknown }` | Tool execution |
| `turn_complete` | `{}` | Agent finished responding |
| `error` | `{ message: string }` | Error occurred |
| `ready` | `{ model: string, harness: string }` | Harness started |
| `interrupted` | `{}` | Conversation interrupted |
| `configured` | `{ model: string }` | Config hot-reloaded |
| `shutdown` | `{}` | Clean shutdown |
| `heartbeat` | `{ status: string, message_count: number }` | Periodic heartbeat |

---

## 2. PiHarness Implementation

Embeds the `@mariozechner/pi-coding-agent` SDK as a TypeScript library within the runner process.

### Initialization

```typescript
import { createAgentSession, AuthStorage, ModelRegistry, createCodingTools, SessionManager, SettingsManager, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

// In start():
const authStorage = AuthStorage.create();
if (process.env.ANTHROPIC_API_KEY) {
  authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
}
const modelRegistry = new ModelRegistry(authStorage);

const [provider, modelName] = config.model.split("/");
const model = getModel(provider, modelName);

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
```

### Event Mapping

Events are received via `session.subscribe(callback)` which fires a callback for each event object with a `type` field. Reference: [Pi SDK docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        this.callback({ type: "text_delta", payload: { delta: event.assistantMessageEvent.delta } });
      }
      break;
    case "message_end":
      const text = event.message.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      this.callback({ type: "text", payload: { text } });
      break;
    case "tool_execution_start":
      this.callback({ type: "tool_use", payload: { tool: event.toolName, status: "started" } });
      break;
    case "tool_execution_end":
      this.callback({ type: "tool_use", payload: { tool: event.toolName, status: "completed", result: event.result } });
      break;
    case "agent_end":
      this.callback({ type: "turn_complete", payload: {} });
      break;
  }
});
```

| Pi SDK Event | Our Event |
|---|---|
| `message_update` + `assistantMessageEvent.type === "text_delta"` | `text_delta` |
| `message_end` | `text` (extract full text from message content blocks) |
| `tool_execution_start` | `tool_use` (with tool name, status: started) |
| `tool_execution_end` | `tool_use` (with tool name, result, status: completed) |
| `agent_end` | `turn_complete` |

Pi SDK errors during streaming are caught in a try/catch around `session.prompt()` and emitted as `error` events.

### Message Handling

- `sendMessage(text, from)` — calls `session.prompt(text)` (prepends `[Message from agent "name"]` for agent messages). Sets internal `processing` flag to true before, false after (including on error)
- `interrupt()` — creates a new session (Pi SDK manages conversation state internally). The old session is discarded
- `stop()` — sets a `stopped` flag that suppresses further event emission via the callback. No explicit SDK cleanup needed
- `isProcessing()` — returns internal `processing` flag

### Auth

Pi SDK reads `ANTHROPIC_API_KEY` from env or via `authStorage.setRuntimeApiKey()`. The env file is already written to `/workspace/.env` by the Elixir bootstrap.

### Model Format

Pi uses provider/model format: `"anthropic/claude-sonnet-4-6"`. The config stores this format directly; PiHarness splits on `/` to call `getModel(provider, modelName)`.

---

## 3. ClaudeCodeHarness Implementation

Spawns `claude -p` as a subprocess for each message. Pre-installed on Sprite VMs.

### Message Handling

```typescript
// In sendMessage():
const args = [
  "-p", text,
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--allowedTools", "Bash,Read,Edit,Write",
  "--model", config.model,  // e.g. "claude-sonnet-4-6"
];

if (config.systemPrompt) {
  args.push("--append-system-prompt", config.systemPrompt);
}

if (this.sessionId) {
  args.push("--resume", this.sessionId);
}

const proc = Bun.spawn(["claude", ...args], {
  cwd: config.cwd,
  env: process.env,
  stdout: "pipe",
});
```

### Event Mapping

Claude Code `stream-json` emits newline-delimited JSON objects. Each line is a JSON object with a `type` field. Sample output:

```jsonl
{"type":"system","subtype":"init","session_id":"abc123",...}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"..."}}}
{"type":"result","subtype":"success","result":"Full response text","session_id":"abc123",...}
```

Parsing logic:

```typescript
// For each JSONL line from subprocess stdout:
const obj = JSON.parse(line);

if (obj.type === "system" && obj.session_id) {
  this.sessionId = obj.session_id;
}

if (obj.type === "stream_event") {
  const delta = obj.event?.delta;
  if (delta?.type === "text_delta") {
    this.callback({ type: "text_delta", payload: { delta: delta.text } });
  }
  // Tool use content blocks appear as content_block_start with type "tool_use"
  if (obj.event?.type === "content_block_start" && obj.event?.content_block?.type === "tool_use") {
    this.callback({ type: "tool_use", payload: { tool: obj.event.content_block.name, status: "started" } });
  }
}

if (obj.type === "result") {
  this.callback({ type: "text", payload: { text: obj.result } });
  this.callback({ type: "turn_complete", payload: {} });
  if (obj.session_id) this.sessionId = obj.session_id;
}
```

| Claude Code Event | Our Event |
|---|---|
| `stream_event` with `delta.type === "text_delta"` | `text_delta` |
| `stream_event` with `content_block_start` + `tool_use` | `tool_use` (started) |
| `result` | `text` + `turn_complete` |

### Session Continuity

- First `sendMessage()` — no `--resume` flag, captures `session_id` from `system` or `result` events
- Subsequent calls — pass `--resume SESSION_ID` for multi-turn conversation
- `interrupt()` — kills active subprocess (if running), clears `sessionId`. Next message starts a fresh conversation. If no subprocess is running, interrupt is a no-op beyond clearing the session
- `isProcessing()` — returns true while a subprocess is active

### Auth

Claude CLI reads `ANTHROPIC_API_KEY` from environment automatically. No additional auth setup needed.

### Model Format

Claude Code uses bare model names: `"claude-sonnet-4-6"`. The config stores this directly.

---

## 4. Agent Runner Refactor

### File Structure

```
priv/sprite/
  agent-runner.ts           # Entry point: inbox watcher, config loader, harness dispatch
  harness/
    types.ts                # Harness, HarnessConfig, AgentEvent interfaces
    pi-harness.ts           # Pi SDK implementation
    claude-code-harness.ts  # Claude CLI implementation
    index.ts                # createHarness() factory
  package.json              # Updated deps
  tsconfig.json             # May need path updates for harness/ subdirectory
```

### Entry Point Changes

`agent-runner.ts` refactored:

1. **Remove** direct `@anthropic-ai/sdk` usage
2. **Add** harness factory: `createHarness(config.harness)` returns the appropriate implementation
3. **Delegate** message processing to harness instead of calling Anthropic SDK
4. **Keep** inbox watching, JSONL emit, config loading, heartbeat, shutdown handling

```typescript
// Simplified main flow:
const config = await loadConfig();
let harness = createHarness(config.harness);

harness.onEvent((event) => emit(event.type, event.payload));
await harness.start({ model: config.model, systemPrompt: config.system_prompt, cwd: "/workspace" });

emit("ready", { model: config.model, harness: config.harness });

// processInbox serializes messages (awaits each before processing next):
for (const envelope of sortedInboxFiles) {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
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
    const newConfig = await loadConfig();
    Object.assign(config, newConfig);
    harness = createHarness(config.harness);
    harness.onEvent((event) => emit(event.type, event.payload));
    await harness.start({ model: config.model, systemPrompt: config.system_prompt, cwd: "/workspace" });
    emit("configured", { model: config.model });
  }
}
```

### Config File Change

`agent-config.json` gains a `harness` field:

```json
{
  "harness": "pi",
  "model": "anthropic/claude-sonnet-4-6",
  "system_prompt": "You are a helpful assistant.",
  "max_tokens": 4096
}
```

### Dependencies

**package.json** updated:
- **Remove:** `@anthropic-ai/sdk`
- **Add:** `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`

---

## 5. Elixir Schema & Migration

### Migration

Add `harness` column to `agents` table:

```elixir
alter table(:agents) do
  add :harness, :string, default: "pi", null: false
end
```

### Schema Change

In `lib/shire/agents/agent.ex`:

```elixir
field :harness, Ecto.Enum,
  values: [:pi, :claude_code],
  default: :pi
```

Add `:harness` to the `cast/3` fields list in the changeset.

### AgentManager Changes

**Config generation:** The bootstrap phase writes `agent.harness` into the config JSON. The default model value depends on the harness:

```elixir
default_model = case agent.harness do
  :claude_code -> "claude-sonnet-4-6"
  _ -> "anthropic/claude-sonnet-4-6"
end

config = Jason.encode!(%{
  harness: agent.harness || "pi",
  model: agent.model || default_model,
  system_prompt: agent.system_prompt || "You are a helpful assistant.",
  max_tokens: 4096
})
```

**File deployment:** The bootstrap phase must deploy the entire `priv/sprite/` directory to the VM, not just `agent-runner.ts` and `package.json`. The new `harness/` subdirectory contains 4 files that must be present. Update the bootstrap to copy all `.ts` files:

```elixir
# Deploy all TypeScript source files
for file <- ["agent-runner.ts", "harness/types.ts", "harness/pi-harness.ts",
             "harness/claude-code-harness.ts", "harness/index.ts"] do
  source = File.read!(Application.app_dir(:shire, "priv/sprite/#{file}"))
  Sprites.Filesystem.write(fs, "/workspace/#{file}", source)
end
```

No change to how AgentManager spawns the runner — it's still `bun run agent-runner.ts`.

---

## 6. UI Changes

### AgentForm

Add a harness select dropdown to the create/edit form:

- Label: "Harness"
- Options: Pi, Claude Code
- Default: Pi
- Position: above the model field (harness choice may inform model selection)

### AgentShow

Display the harness as a badge next to the model info (e.g., "Pi" or "Claude Code").

### AgentCard

Show harness in the card subtitle alongside model.

---

## 7. Testing Strategy

### TypeScript Tests (bun:test)

- **PiHarness tests:** Mock `createAgentSession` and `session.prompt()`. Verify:
  - Event mapping: Pi SDK events → our unified events
  - Agent message prefix prepended correctly
  - `interrupt()` creates a new session
  - `isProcessing()` returns true during `sendMessage()`, false after
  - Errors during `session.prompt()` emit `error` event
  - `stop()` suppresses further event emission
- **ClaudeCodeHarness tests:** Mock `Bun.spawn`. Verify:
  - CLI arg construction (model, system prompt, allowedTools)
  - `--resume SESSION_ID` passed on second+ calls
  - Session ID captured from `system` event
  - JSONL parsing of `stream_event` and `result` lines
  - `interrupt()` kills subprocess and clears session ID
  - `isProcessing()` tracks subprocess lifecycle
  - Non-zero exit code emits `error` event
- **createHarness factory tests:** Verify correct class returned for "pi" and "claude_code", throws on unknown
- **Agent runner integration tests:** Verify harness selection from config, inbox processing delegates to harness, emit protocol unchanged
- **Existing tests:** Update to work with new harness abstraction (mock harness instead of mock Anthropic client)

### Elixir Tests

- **Migration test:** Verify harness column exists with default
- **Schema test:** Verify harness field in changeset, enum validation
- **AgentManager test:** Verify harness written to config JSON

### Frontend Tests (Vitest)

- **AgentForm test:** Verify harness select renders, pushes correct value on submit
- **AgentShow test:** Verify harness badge renders

---

## 8. Error Handling

- **PiHarness:** SDK errors caught in try/catch around `session.prompt()`, emitted as `error` events
- **ClaudeCodeHarness:** Subprocess exit codes checked; non-zero emits `error`. Stdout parse failures logged and skipped. Subprocess timeout after configurable duration
- **Unknown harness:** `createHarness()` throws on unrecognized harness name; runner emits `error` and exits
- **Harness crash during message:** Emit `error` event, keep runner alive for next inbox message

---

## 9. What's NOT Changing

- Mailbox protocol (inbox/outbox file format, sequence numbers)
- Bootstrap script (`bootstrap.sh` — still creates directories)
- JSONL stdout protocol (same event types consumed by AgentManager)
- AgentManager's spawn mechanism (still `bun run agent-runner.ts`)
- Coordinator routing logic
- PubSub event broadcasting

## 10. What IS Changing

- **agent-runner.ts** — refactored from Anthropic SDK to harness adapter pattern
- **package.json** — `@anthropic-ai/sdk` removed, `@mariozechner/pi-coding-agent` + `@mariozechner/pi-ai` added
- **New files** — `harness/types.ts`, `harness/pi-harness.ts`, `harness/claude-code-harness.ts`, `harness/index.ts`
- **agent_manager.ex** — deploys harness files to VM, writes `harness` field to config JSON, harness-aware default model
- **agent.ex** — new `harness` enum field
- **Migration** — adds `harness` column
- **AgentForm.tsx** — harness select dropdown
- **AgentShow.tsx / AgentCard.tsx** — harness badge display
- **agent-runner.test.ts** — rewritten to test harness abstraction instead of Anthropic SDK mocks
- **Configure behavior** — now resets conversation state (teardown + rebuild harness). This is a deliberate change from the previous in-place mutation
