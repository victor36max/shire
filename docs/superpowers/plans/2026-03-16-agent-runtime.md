# Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to run inside Sprite VMs — with a mailbox protocol for message passing, a Bun-based agent runner daemon, and Elixir GenServers to manage agent lifecycle and coordination.

**Architecture:** The Elixir side has a `Mailbox` module (pure encode/decode + Sprite filesystem writes), an `AgentManager` GenServer per agent (manages one Sprite's lifecycle, spawns the agent runner, processes stdout), and a `Coordinator` GenServer (starts/stops agents, routes inter-agent messages). The TypeScript side has an `agent-runner.ts` Bun daemon that watches the inbox directory via `fs.watch` and dispatches messages to the Pi SDK, streaming responses as JSONL to stdout.

**Tech Stack:** Elixir/Phoenix, Sprites SDK (sprites-ex), Bun + TypeScript, Pi SDK (`@mariozechner/pi-coding-agent`), Phoenix PubSub

---

## File Structure

```
lib/
  sprite_agents/
    mailbox.ex                    # Pure message encode/decode + Sprite write helpers
    agent/
      agent_manager.ex            # GenServer: one per active agent, manages Sprite lifecycle
      coordinator.ex              # GenServer: starts/stops agents, routes messages
    agents.ex                     # (modify) Add get_agent_by_name!/1

config/
  config.exs                      # (modify) Add Sprites client config
  runtime.exs                     # (modify) Add SPRITES_TOKEN env var
  dev.exs                         # (modify) Add dev Sprites token

lib/sprite_agents/application.ex  # (modify) Add Registry, DynamicSupervisor, Coordinator

priv/sprite/
  agent-runner.ts                 # Bun daemon: watches inbox, dispatches to Pi SDK
  bootstrap.sh                    # Shell script: creates mailbox dirs on Sprite
  package.json                    # Bun deps for agent-runner

test/
  sprite_agents/
    mailbox_test.exs              # Unit tests for Mailbox encode/decode
    agent/
      agent_manager_test.exs      # AgentManager tests with mocked Sprites
      coordinator_test.exs        # Coordinator tests
```

---

## Chunk 1: Mailbox Module

### Task 1: Mailbox encode/decode (pure functions)

**Files:**
- Create: `lib/sprite_agents/mailbox.ex`
- Create: `test/sprite_agents/mailbox_test.exs`

The Mailbox module handles encoding/decoding message envelopes and generating filenames. These are pure functions with no side effects — fully unit-testable.

Message filename format: `{seq:06d}_{timestamp_ms}_{type}.json`
Message envelope: `%{seq: int, ts: int, type: string, from: string, payload: map}`

- [ ] **Step 1: Write failing tests for encode/decode**

```elixir
# test/sprite_agents/mailbox_test.exs
defmodule SpriteAgents.MailboxTest do
  use ExUnit.Case, async: true

  alias SpriteAgents.Mailbox

  describe "encode/3" do
    test "encodes a user_message envelope" do
      envelope = Mailbox.encode("user_message", "coordinator", %{text: "hello"}, seq: 1, ts: 1710500000000)
      decoded = Jason.decode!(envelope)
      assert decoded["seq"] == 1
      assert decoded["ts"] == 1710500000000
      assert decoded["type"] == "user_message"
      assert decoded["from"] == "coordinator"
      assert decoded["payload"]["text"] == "hello"
    end

    test "encodes an agent_message envelope" do
      envelope = Mailbox.encode("agent_message", "alice", %{text: "hi bob"}, seq: 5, ts: 1710500001000)
      decoded = Jason.decode!(envelope)
      assert decoded["type"] == "agent_message"
      assert decoded["from"] == "alice"
      assert decoded["payload"]["text"] == "hi bob"
    end

    test "auto-generates seq and ts when not provided" do
      envelope = Mailbox.encode("user_message", "coordinator", %{text: "hello"})
      decoded = Jason.decode!(envelope)
      assert is_integer(decoded["ts"])
      assert decoded["ts"] > 0
    end
  end

  describe "decode/1" do
    test "decodes a valid envelope" do
      json = Jason.encode!(%{seq: 1, ts: 1710500000000, type: "user_message", from: "coordinator", payload: %{text: "hello"}})
      assert {:ok, msg} = Mailbox.decode(json)
      assert msg.type == "user_message"
      assert msg.from == "coordinator"
      assert msg.payload == %{"text" => "hello"}
    end

    test "returns error for invalid JSON" do
      assert {:error, _} = Mailbox.decode("not json")
    end
  end

  describe "filename/2" do
    test "formats filename with zero-padded seq" do
      assert Mailbox.filename(1, "user_message", ts: 1710500000000) ==
               "000001_1710500000000_user_message.json"
    end

    test "formats filename with large seq" do
      assert Mailbox.filename(999, "agent_message", ts: 1710500001000) ==
               "000999_1710500001000_agent_message.json"
    end
  end

  describe "parse_stdout_line/1" do
    test "parses a valid JSONL event" do
      line = Jason.encode!(%{type: "text_delta", payload: %{delta: "hello"}})
      assert {:ok, event} = Mailbox.parse_stdout_line(line)
      assert event["type"] == "text_delta"
      assert event["payload"]["delta"] == "hello"
    end

    test "returns error for non-JSON line" do
      assert {:error, _} = Mailbox.parse_stdout_line("some random output")
    end

    test "ignores empty lines" do
      assert :ignore = Mailbox.parse_stdout_line("")
      assert :ignore = Mailbox.parse_stdout_line("\n")
    end
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/sprite_agents/mailbox_test.exs`
Expected: Compilation error — `Mailbox` module doesn't exist.

- [ ] **Step 3: Implement Mailbox module**

```elixir
# lib/sprite_agents/mailbox.ex
defmodule SpriteAgents.Mailbox do
  @moduledoc """
  Encodes/decodes mailbox message envelopes and generates filenames.
  Also provides helpers to write messages to a Sprite's inbox via the filesystem API.
  """

  defstruct [:seq, :ts, :type, :from, :payload]

  @inbox_dir "/workspace/mailbox/inbox"

  @doc "Encode a message envelope to JSON."
  def encode(type, from, payload, opts \\ []) do
    ts = Keyword.get(opts, :ts, System.os_time(:millisecond))
    seq = Keyword.get(opts, :seq, 0)

    Jason.encode!(%{
      seq: seq,
      ts: ts,
      type: type,
      from: from,
      payload: payload
    })
  end

  @doc "Decode a JSON message envelope."
  def decode(json) do
    case Jason.decode(json) do
      {:ok, %{"seq" => seq, "ts" => ts, "type" => type, "from" => from, "payload" => payload}} ->
        {:ok, %__MODULE__{seq: seq, ts: ts, type: type, from: from, payload: payload}}

      {:ok, _} ->
        {:error, :invalid_envelope}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Generate a mailbox filename."
  def filename(seq, type, opts \\ []) do
    ts = Keyword.get(opts, :ts, System.os_time(:millisecond))
    seq_str = seq |> Integer.to_string() |> String.pad_leading(6, "0")
    "#{seq_str}_#{ts}_#{type}.json"
  end

  @doc "Parse a JSONL stdout line from the agent runner."
  def parse_stdout_line(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      :ignore
    else
      case Jason.decode(trimmed) do
        {:ok, event} -> {:ok, event}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @doc """
  Write a message to a Sprite's inbox using the Sprites filesystem API.
  Performs atomic write: writes to .tmp file then renames.
  """
  def write_inbox(sprite, type, payload, opts \\ []) do
    from = Keyword.get(opts, :from, "coordinator")
    seq = Keyword.get(opts, :seq, next_seq(sprite))
    ts = System.os_time(:millisecond)

    json = encode(type, from, payload, seq: seq, ts: ts)
    fname = filename(seq, type, ts: ts)
    tmp_path = "#{@inbox_dir}/.#{fname}.tmp"
    final_path = "#{@inbox_dir}/#{fname}"

    fs = Sprites.filesystem(sprite, @inbox_dir)
    :ok = Sprites.Filesystem.write(fs, tmp_path, json)

    # Atomic rename
    {_, 0} = Sprites.cmd(sprite, "mv", [tmp_path, final_path])
    update_seq(sprite, seq)
    {:ok, seq}
  end

  defp next_seq(sprite) do
    case Sprites.cmd(sprite, "cat", ["/workspace/mailbox/.inbox_seq"]) do
      {output, 0} ->
        output |> String.trim() |> String.to_integer() |> Kernel.+(1)

      _ ->
        1
    end
  end

  defp update_seq(sprite, seq) do
    fs = Sprites.filesystem(sprite, "/workspace/mailbox")
    Sprites.Filesystem.write(fs, "/workspace/mailbox/.inbox_seq", Integer.to_string(seq))
  end
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/sprite_agents/mailbox_test.exs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sprite_agents/mailbox.ex test/sprite_agents/mailbox_test.exs
git commit -m "feat: add Mailbox module with encode/decode and filename helpers"
```

---

### Task 2: Agent runner TypeScript daemon

**Files:**
- Create: `priv/sprite/package.json`
- Create: `priv/sprite/agent-runner.ts`
- Create: `priv/sprite/bootstrap.sh`

The agent runner is a Bun TypeScript daemon that runs inside each Sprite VM. It watches the mailbox inbox for new messages and dispatches them to the Pi SDK, streaming responses as JSONL to stdout.

- [ ] **Step 1: Create package.json for agent runner**

```json
{
  "name": "sprite-agent-runner",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0"
  }
}
```

Note: We start with the Anthropic SDK directly. The Pi SDK (`@mariozechner/pi-coding-agent`) can be swapped in later when its API stabilizes. The agent runner architecture supports either backend.

- [ ] **Step 2: Create bootstrap.sh**

```bash
#!/bin/bash
# bootstrap.sh — Sets up the mailbox directory structure on a Sprite VM.
# Run once when an agent is first created.

set -euo pipefail

mkdir -p /workspace/mailbox/inbox
mkdir -p /workspace/mailbox/outbox
mkdir -p /workspace/skills

echo "0" > /workspace/mailbox/.inbox_seq
echo "0" > /workspace/mailbox/.outbox_seq

echo "Bootstrap complete"
```

- [ ] **Step 3: Create agent-runner.ts**

```typescript
// agent-runner.ts — Bun daemon that watches the inbox and dispatches to AI backend.
// Streams events as JSONL to stdout for the Elixir AgentManager to consume.
import { watch } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";

const INBOX_DIR = "/workspace/mailbox/inbox";
const CONFIG_PATH = "/workspace/agent-config.json";

interface AgentConfig {
  model: string;
  system_prompt: string;
  max_tokens?: number;
}

interface MessageEnvelope {
  seq: number;
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
}

async function loadConfig(): Promise<AgentConfig> {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

async function processMessage(
  client: Anthropic,
  config: AgentConfig,
  messages: Anthropic.MessageParam[],
  envelope: MessageEnvelope
) {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
    const text = envelope.payload.text as string;
    const prefix =
      envelope.type === "agent_message"
        ? `[Message from agent "${envelope.from}"]\n${text}`
        : text;

    messages.push({ role: "user", content: prefix });

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.max_tokens ?? 4096,
        system: config.system_prompt,
        messages,
      });

      stream.on("text", (delta) => {
        emit("text_delta", { delta });
      });

      const finalMessage = await stream.finalMessage();
      const fullText = finalMessage.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      messages.push({ role: "assistant", content: fullText });
      emit("text", { text: fullText });
      emit("turn_complete", {});
    } catch (err) {
      emit("error", { message: String(err) });
    }
  } else if (envelope.type === "interrupt") {
    // TODO: Cancel active streaming request (AbortController) when implemented
    messages.length = 0; // Clear conversation history
    emit("interrupted", {});
  } else if (envelope.type === "shutdown") {
    emit("shutdown", {});
    process.exit(0);
  } else if (envelope.type === "configure") {
    // Hot-reload: re-read config file and apply new settings
    const newConfig = await loadConfig();
    Object.assign(config, newConfig);
    emit("configured", { model: config.model });
  }
}

async function processInbox(
  client: Anthropic,
  config: AgentConfig,
  messages: Anthropic.MessageParam[]
) {
  const files = await readdir(INBOX_DIR);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  for (const file of sorted) {
    const path = join(INBOX_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope: MessageEnvelope = JSON.parse(raw);
      await processMessage(client, config, messages, envelope);
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
    }
  }
}

async function main() {
  const config = await loadConfig();
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [];
  let processing = false;

  emit("ready", { model: config.model });

  // Process any existing inbox messages
  await processInbox(client, config, messages);

  // Watch for new messages
  const watcher = watch(INBOX_DIR, async (eventType, filename) => {
    if (!filename?.endsWith(".json") || processing) return;
    processing = true;
    try {
      await processInbox(client, config, messages);
    } finally {
      processing = false;
    }
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive", message_count: messages.length });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    watcher.close();
    emit("shutdown", {});
    process.exit(0);
  });
}

main().catch((err) => {
  emit("error", { message: `Fatal: ${err}` });
  process.exit(1);
});
```

- [ ] **Step 4: Make bootstrap.sh executable and commit**

```bash
chmod +x priv/sprite/bootstrap.sh
git add priv/sprite/
git commit -m "feat: add agent-runner daemon and bootstrap script for Sprite VMs"
```

---

## Chunk 2: Sprites Client + Supervision Tree

Setting up configuration and supervision tree first, because AgentManager and Coordinator tests depend on the Registry being available.

### Task 3: Update supervision tree

**Files:**
- Modify: `lib/sprite_agents/application.ex`

Add Registry, DynamicSupervisor, and Coordinator to the supervision tree. This must happen before Tasks 4-5 because AgentManager registers via `{:via, Registry, ...}` and Coordinator looks up agents in the Registry.

- [ ] **Step 1: Read current application.ex**

Read the file to understand existing children.

- [ ] **Step 2: Add supervision children**

Add these children to the supervision tree, after `Phoenix.PubSub` and before `SpriteAgentsWeb.Endpoint`:

```elixir
{Registry, keys: :unique, name: SpriteAgents.AgentRegistry},
{DynamicSupervisor, name: SpriteAgents.AgentSupervisor, strategy: :one_for_one},
```

Note: Don't add `Coordinator` yet — it will be added when Task 5 implements it.

- [ ] **Step 3: Verify compilation**

Run: `mix compile --warnings-as-errors`
Expected: Compiles with no warnings.

- [ ] **Step 4: Run all tests**

Run: `mix test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sprite_agents/application.ex
git commit -m "feat: add AgentRegistry and AgentSupervisor to supervision tree"
```

---

### Task 4: Configure Sprites client

**Files:**
- Modify: `config/config.exs`
- Modify: `config/runtime.exs`

The Sprites client needs a token to authenticate with the Sprites API. We configure it via environment variable.

- [ ] **Step 1: Add Sprites config to config.exs**

Add to `config/config.exs`, after the existing Cloak config:

```elixir
# Sprites client — token configured per-environment
config :sprite_agents, :sprites_token, nil
```

- [ ] **Step 2: Add runtime token to runtime.exs**

Add to `config/runtime.exs` **outside** the `if config_env() == :prod do` block (so it applies in dev too — this is a runtime config, not compile-time):

```elixir
# Sprites — optional in dev, required in prod
sprites_token = System.get_env("SPRITES_TOKEN")

if config_env() == :prod && is_nil(sprites_token) do
  raise "environment variable SPRITES_TOKEN is missing."
end

config :sprite_agents, :sprites_token, sprites_token
```

- [ ] **Step 3: Commit**

```bash
git add config/config.exs config/runtime.exs
git commit -m "feat: add Sprites token configuration"
```

---

## Chunk 3: AgentManager + Coordinator GenServers

### Task 5: AgentManager GenServer

**Files:**
- Create: `lib/sprite_agents/agent/agent_manager.ex`
- Create: `test/sprite_agents/agent/agent_manager_test.exs`
- Modify: `lib/sprite_agents/agents.ex` (add `get_agent_by_name!/1`)

The AgentManager is a GenServer that manages a single agent's Sprite lifecycle. One AgentManager per active agent.

**Lifecycle phases:**
1. `:starting` — Create/wake the Sprite VM
2. `:bootstrapping` — Run bootstrap.sh, write config, deploy agent-runner
3. `:active` — Spawn agent-runner via `Sprites.spawn`, process stdout JSONL
4. `:failed` — Error state

- [ ] **Step 1: Add get_agent_by_name!/1 to Agents context with test**

Add to `lib/sprite_agents/agents.ex`:

```elixir
def get_agent_by_name!(name), do: Repo.get_by!(Agent, name: name)
```

Add test to `test/sprite_agents/agents_test.exs` in the "agents" describe block:

```elixir
test "get_agent_by_name!/1 returns the agent with given name" do
  {:ok, agent} = Agents.create_agent(@valid_agent_attrs)
  found = Agents.get_agent_by_name!(agent.name)
  assert found.id == agent.id
end
```

- [ ] **Step 2: Write AgentManager tests**

```elixir
# test/sprite_agents/agent/agent_manager_test.exs
defmodule SpriteAgents.Agent.AgentManagerTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agent.AgentManager
  alias SpriteAgents.Agents

  setup do
    {:ok, agent} = Agents.create_agent(%{
      name: "test-agent",
      model: "claude-sonnet-4-6",
      system_prompt: "You are a test agent."
    })
    %{agent: agent}
  end

  describe "start_link/1" do
    test "starts the GenServer and registers with the agent name", %{agent: agent} do
      {:ok, pid} = start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})
      assert Process.alive?(pid)
      assert GenServer.call(pid, :get_state) |> Map.get(:phase) == :idle
    end
  end

  describe "state management" do
    test "get_state returns current state", %{agent: agent} do
      {:ok, pid} = start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})
      state = AgentManager.get_state(pid)
      assert state.agent_name == "test-agent"
      assert state.phase == :idle
    end
  end

  describe "send_message/3" do
    test "returns error when agent is not active", %{agent: agent} do
      {:ok, pid} = start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})
      assert {:error, :not_active} = GenServer.call(pid, {:send_message, "hello", :user})
    end
  end
end
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `mix test test/sprite_agents/agent/agent_manager_test.exs`
Expected: Compilation error — `AgentManager` module doesn't exist.

- [ ] **Step 4: Implement AgentManager**

```elixir
# lib/sprite_agents/agent/agent_manager.ex
defmodule SpriteAgents.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's Sprite lifecycle.
  One AgentManager per active agent.
  """
  use GenServer
  require Logger

  alias SpriteAgents.{Agents, Mailbox}

  defstruct [
    :agent_id,
    :agent_name,
    :sprites_client,
    :sprite,
    :command,
    :command_ref,
    :pubsub_topic,
    phase: :idle,
    inbox_seq: 0,
    buffer: ""
  ]

  # --- Public API ---

  def start_link(opts) do
    agent = Keyword.fetch!(opts, :agent)
    GenServer.start_link(__MODULE__, opts, name: via(agent.name))
  end

  def send_message(name, text, from \\ :user) do
    GenServer.call(via(name), {:send_message, text, from})
  end

  def get_state(server) do
    GenServer.call(server, :get_state)
  end

  def stop(name) do
    GenServer.stop(via(name))
  end

  defp via(name) do
    {:via, Registry, {SpriteAgents.AgentRegistry, name}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent = Keyword.fetch!(opts, :agent)
    client = Keyword.get(opts, :sprites_client)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      agent_id: agent.id,
      agent_name: agent.name,
      sprites_client: client,
      pubsub_topic: "agent:#{agent.name}",
      phase: :idle
    }

    if skip_sprite do
      {:ok, state}
    else
      {:ok, state, {:continue, :start_sprite}}
    end
  end

  @impl true
  def handle_continue(:start_sprite, state) do
    state = %{state | phase: :starting}
    broadcast(state, {:status, :starting})

    sprite_name = "flyagents-#{state.agent_name}"

    case get_or_create_sprite(state.sprites_client, sprite_name) do
      {:ok, sprite} ->
        state = %{state | sprite: sprite, phase: :bootstrapping}
        broadcast(state, {:status, :bootstrapping})
        {:noreply, state, {:continue, :bootstrap}}

      {:error, reason} ->
        Logger.error("Failed to create sprite for #{state.agent_name}: #{inspect(reason)}")
        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_continue(:bootstrap, state) do
    sprite = state.sprite

    try do
      # Run bootstrap script
      bootstrap_script = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/bootstrap.sh"))
      {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script])

      # Write agent config
      agent = Agents.get_agent!(state.agent_id)
      secrets = Agents.effective_secrets(state.agent_id)

      config = Jason.encode!(%{
        model: agent.model || "claude-sonnet-4-6",
        system_prompt: agent.system_prompt || "You are a helpful assistant.",
        max_tokens: 4096
      })

      fs = Sprites.filesystem(sprite)
      Sprites.Filesystem.write(fs, "/workspace/agent-config.json", config)

      # Write secrets as environment variables file
      env_content = Enum.map_join(secrets, "\n", fn s -> "#{s.key}=#{s.value}" end)
      Sprites.Filesystem.write(fs, "/workspace/.env", env_content)

      # Deploy agent-runner
      runner_source = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/agent-runner.ts"))
      Sprites.Filesystem.write(fs, "/workspace/agent-runner.ts", runner_source)

      pkg_json = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/package.json"))
      Sprites.Filesystem.write(fs, "/workspace/package.json", pkg_json)

      # Install deps
      {_, 0} = Sprites.cmd(sprite, "bash", ["-c", "cd /workspace && bun install"], timeout: 60_000)

      {:noreply, state, {:continue, :spawn_runner}}
    rescue
      e ->
        Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    env = load_env_vars(state.sprite)

    case Sprites.spawn(state.sprite, "bun", ["run", "/workspace/agent-runner.ts"],
           env: env,
           dir: "/workspace"
         ) do
      {:ok, command} ->
        state = %{state | command: command, command_ref: command.ref, phase: :active}
        broadcast(state, {:status, :active})
        update_agent_status(state, :active)
        {:noreply, state}

      {:error, reason} ->
        Logger.error("Failed to spawn agent runner for #{state.agent_name}: #{inspect(reason)}")
        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_call({:send_message, text, from}, _from_pid, %{phase: :active} = state) do
    from_str = case from do
      :user -> "coordinator"
      {:agent, name} -> name
    end

    type = case from do
      :user -> "user_message"
      {:agent, _} -> "agent_message"
    end

    case Mailbox.write_inbox(state.sprite, type, %{text: text}, from: from_str, seq: state.inbox_seq + 1) do
      {:ok, seq} ->
        {:reply, :ok, %{state | inbox_seq: seq}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:send_message, _text, _from}, _from_pid, state) do
    {:reply, {:error, :not_active}, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, Map.from_struct(state), state}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    Enum.each(lines, fn line ->
      case Mailbox.parse_stdout_line(line) do
        {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
          # Route inter-agent message via Coordinator
          SpriteAgents.Agent.Coordinator.route_agent_message(state.agent_name, to, text)

        {:ok, event} ->
          broadcast(state, {:agent_event, event})

        :ignore ->
          :ok

        {:error, _} ->
          Logger.warning("Unparseable stdout from #{state.agent_name}: #{inspect(line)}")
      end
    end)

    {:noreply, %{state | buffer: buffer}}
  end

  # Agent runner exited
  @impl true
  def handle_info({:exit, %{ref: ref}, code}, %{command_ref: ref} = state) do
    Logger.warning("Agent runner for #{state.agent_name} exited with code #{code}")
    state = %{state | phase: :failed, command: nil, command_ref: nil}
    broadcast(state, {:status, :failed})
    update_agent_status(state, :failed)
    {:noreply, state}
  end

  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Agent runner error for #{state.agent_name}: #{inspect(reason)}")
    {:noreply, state}
  end

  def handle_info(msg, state) do
    Logger.debug("AgentManager #{state.agent_name} unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # --- Private ---

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [rest]} = Enum.split(parts, -1)
    {complete, rest}
  end

  defp broadcast(state, message) do
    Phoenix.PubSub.broadcast(SpriteAgents.PubSub, state.pubsub_topic, message)
  end

  defp update_agent_status(state, status) do
    agent = Agents.get_agent!(state.agent_id)
    Agents.update_agent(agent, %{status: status})
  end

  defp get_or_create_sprite(client, name) do
    case Sprites.get_sprite(client, name) do
      {:ok, sprite} -> {:ok, sprite}
      {:error, :not_found} -> Sprites.create(client, name)
      {:error, reason} -> {:error, reason}
    end
  end

  defp load_env_vars(sprite) do
    case Sprites.cmd(sprite, "cat", ["/workspace/.env"]) do
      {content, 0} ->
        content
        |> String.split("\n", trim: true)
        |> Enum.map(fn line ->
          case String.split(line, "=", parts: 2) do
            [key, value] -> {key, value}
            _ -> nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end
end
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `mix test test/sprite_agents/agent/agent_manager_test.exs`
Expected: PASS. (Tests use `skip_sprite: true` to avoid needing a real Sprites connection.)

- [ ] **Step 6: Commit**

```bash
git add lib/sprite_agents/agent/agent_manager.ex test/sprite_agents/agent/agent_manager_test.exs lib/sprite_agents/agents.ex
git commit -m "feat: add AgentManager GenServer for Sprite lifecycle management"
```

---

### Task 6: Coordinator GenServer

**Files:**
- Create: `lib/sprite_agents/agent/coordinator.ex`
- Create: `test/sprite_agents/agent/coordinator_test.exs`

The Coordinator starts/stops agents and routes inter-agent messages.

- [ ] **Step 1: Write Coordinator tests**

```elixir
# test/sprite_agents/agent/coordinator_test.exs
defmodule SpriteAgents.Agent.CoordinatorTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agent.Coordinator
  alias SpriteAgents.Agents

  setup do
    {:ok, agent} = Agents.create_agent(%{
      name: "coord-test-agent",
      model: "claude-sonnet-4-6",
      system_prompt: "Test"
    })
    %{agent: agent}
  end

  describe "lookup/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.lookup("nonexistent")
    end
  end

  describe "stop_agent/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.stop_agent("nonexistent")
    end
  end

  describe "list_running/0" do
    test "returns empty list when no agents are running" do
      assert Coordinator.list_running() == []
    end
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/sprite_agents/agent/coordinator_test.exs`
Expected: Compilation error — `Coordinator` module doesn't exist.

- [ ] **Step 3: Implement Coordinator**

```elixir
# lib/sprite_agents/agent/coordinator.ex
defmodule SpriteAgents.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle: starts/stops AgentManagers via DynamicSupervisor,
  routes inter-agent messages.
  """
  use GenServer
  require Logger

  alias SpriteAgents.Agent.AgentManager
  alias SpriteAgents.Agents

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  def start_agent(agent_name) do
    GenServer.call(__MODULE__, {:start_agent, agent_name})
  end

  def stop_agent(agent_name) do
    GenServer.call(__MODULE__, {:stop_agent, agent_name})
  end

  def send_message(agent_name, text) do
    AgentManager.send_message(agent_name, text, :user)
  end

  def route_agent_message(from_agent, to_agent, text) do
    AgentManager.send_message(to_agent, text, {:agent, from_agent})
  end

  def lookup(agent_name) do
    case Registry.lookup(SpriteAgents.AgentRegistry, agent_name) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  def list_running do
    Registry.select(SpriteAgents.AgentRegistry, [{{:"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}])
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{}}
  end

  @impl true
  def handle_call({:start_agent, agent_name}, _from, state) do
    case lookup(agent_name) do
      {:ok, _pid} ->
        {:reply, {:error, :already_running}, state}

      {:error, :not_found} ->
        token = Application.get_env(:sprite_agents, :sprites_token)

        if is_nil(token) do
          {:reply, {:error, :no_sprites_token}, state}
        else
          agent = Agents.get_agent_by_name!(agent_name)
          client = Sprites.new(token)

          case DynamicSupervisor.start_child(
               SpriteAgents.AgentSupervisor,
               {AgentManager, agent: agent, sprites_client: client}
             ) do
          {:ok, pid} ->
            Logger.info("Started agent #{agent_name} (pid: #{inspect(pid)})")
            {:reply, {:ok, pid}, state}

          {:error, reason} ->
            Logger.error("Failed to start agent #{agent_name}: #{inspect(reason)}")
            {:reply, {:error, reason}, state}
        end
        end
    end
  end

  @impl true
  def handle_call({:stop_agent, agent_name}, _from, state) do
    case lookup(agent_name) do
      {:ok, pid} ->
        DynamicSupervisor.terminate_child(SpriteAgents.AgentSupervisor, pid)
        Logger.info("Stopped agent #{agent_name}")
        {:reply, :ok, state}

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/sprite_agents/agent/coordinator_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

Also add `SpriteAgents.Agent.Coordinator` to the supervision tree in `application.ex`, after `AgentSupervisor`:

```elixir
{Registry, keys: :unique, name: SpriteAgents.AgentRegistry},
{DynamicSupervisor, name: SpriteAgents.AgentSupervisor, strategy: :one_for_one},
SpriteAgents.Agent.Coordinator,
```

```bash
git add lib/sprite_agents/agent/coordinator.ex test/sprite_agents/agent/coordinator_test.exs lib/sprite_agents/application.ex
git commit -m "feat: add Coordinator GenServer for agent lifecycle management"
```

---

## Chunk 4: UI Integration + Final Verification

### Task 7: Start/Stop agent from UI

**Files:**
- Modify: `lib/sprite_agents_web/live/agent_live/show.ex` — Add start/stop buttons
- Modify: `assets/react-components/AgentShow.tsx` — Add start/stop UI
- Create: `assets/test/AgentShow.test.tsx` — Update tests for new buttons

This task connects the web UI to the Coordinator, allowing users to start/stop agents.

- [ ] **Step 1: Write AgentShow tests for start/stop buttons**

Add tests in `assets/test/AgentShow.test.tsx`:

```tsx
it("shows Start button for created agent", () => {
  render(<AgentShow agent={{ ...agent, status: "created" }} pushEvent={vi.fn()} />);
  expect(screen.getByText("Start Agent")).toBeInTheDocument();
});

it("shows Stop button for active agent", () => {
  render(<AgentShow agent={{ ...agent, status: "active" }} pushEvent={vi.fn()} />);
  expect(screen.getByText("Stop Agent")).toBeInTheDocument();
});

it("calls pushEvent with start-agent", async () => {
  const pushEvent = vi.fn();
  render(<AgentShow agent={{ ...agent, status: "created" }} pushEvent={pushEvent} />);
  await userEvent.click(screen.getByText("Start Agent"));
  expect(pushEvent).toHaveBeenCalledWith("start-agent", {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd assets && bun run test`
Expected: FAIL — Start/Stop buttons don't exist yet.

- [ ] **Step 3: Add start/stop buttons to AgentShow.tsx**

Update the button section in `AgentShow.tsx` to include Start/Stop based on agent status:

```tsx
<div className="flex items-center gap-2">
  <Button variant="outline" onClick={() => (window.location.href = "/")}>
    Back
  </Button>
  {agent.status === "created" || agent.status === "sleeping" || agent.status === "failed" ? (
    <Button onClick={() => pushEvent("start-agent", {})}>
      Start Agent
    </Button>
  ) : agent.status === "active" || agent.status === "starting" ? (
    <Button variant="destructive" onClick={() => pushEvent("stop-agent", {})}>
      Stop Agent
    </Button>
  ) : null}
  <Button variant="outline" onClick={() => pushEvent("edit", { id: agent.id })}>
    Edit
  </Button>
</div>
```

- [ ] **Step 4: Add handle_event callbacks to AgentLive.Show**

Add to `lib/sprite_agents_web/live/agent_live/show.ex`:

```elixir
@impl true
def handle_event("start-agent", _params, socket) do
  agent = socket.assigns.agent

  case SpriteAgents.Agent.Coordinator.start_agent(agent.name) do
    {:ok, _pid} ->
      agent = Agents.get_agent!(agent.id)
      {:noreply,
       socket
       |> assign(:agent, agent)
       |> put_flash(:info, "Agent starting...")}

    {:error, :already_running} ->
      {:noreply, put_flash(socket, :error, "Agent is already running")}

    {:error, :no_sprites_token} ->
      {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

    {:error, reason} ->
      {:noreply, put_flash(socket, :error, "Failed to start agent: #{inspect(reason)}")}
  end
end

@impl true
def handle_event("stop-agent", _params, socket) do
  agent = socket.assigns.agent

  case SpriteAgents.Agent.Coordinator.stop_agent(agent.name) do
    :ok ->
      agent = Agents.get_agent!(agent.id)
      {:noreply,
       socket
       |> assign(:agent, agent)
       |> put_flash(:info, "Agent stopped")}

    {:error, :not_found} ->
      {:noreply, put_flash(socket, :error, "Agent is not running")}
  end
end
```

Also subscribe to PubSub in mount to receive status updates:

```elixir
def mount(%{"id" => id}, _session, socket) do
  agent = Agents.get_agent!(id)

  if connected?(socket) do
    Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "agent:#{agent.name}")
  end

  {:ok, assign(socket, :agent, agent)}
end

@impl true
def handle_info({:status, _status}, socket) do
  agent = Agents.get_agent!(socket.assigns.agent.id)
  {:noreply, assign(socket, :agent, agent)}
end

@impl true
def handle_info({:agent_event, _event}, socket) do
  # For now, ignore agent events on the show page (chat page will use these)
  {:noreply, socket}
end
```

- [ ] **Step 5: Run frontend and backend tests**

Run:
```bash
cd assets && bun run test
mix test
```
Expected: All tests PASS.

- [ ] **Step 6: TypeScript typecheck**

Run: `cd assets && bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add lib/sprite_agents_web/live/agent_live/show.ex assets/react-components/AgentShow.tsx assets/test/AgentShow.test.tsx
git commit -m "feat: add start/stop agent controls to agent detail page"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full backend test suite**

Run: `mix test`
Expected: All tests PASS.

- [ ] **Step 2: Check Elixir formatting**

Run: `mix format --check-formatted`
Expected: All files formatted correctly.

- [ ] **Step 3: Run frontend tests**

Run: `cd assets && bun run test`
Expected: All tests PASS.

- [ ] **Step 4: TypeScript typecheck**

Run: `cd assets && bun run tsc --noEmit`
Expected: No errors.

Note: You may need to add `priv/sprite` to the `exclude` array in `assets/tsconfig.json` since agent-runner.ts runs in Bun (not the Vite build). If tsc tries to check it, add:
```json
"exclude": ["node_modules", "../priv/sprite"]
```

- [ ] **Step 5: Elixir compilation check**

Run: `mix compile --warnings-as-errors`
Expected: Compiles with no warnings.

- [ ] **Step 6: Manual smoke test (if SPRITES_TOKEN available)**

1. Start the server: `mix phx.server`
2. Create an agent via UI
3. Navigate to agent detail page
4. Click "Start Agent"
5. Verify status changes in UI

---

## Notes

### Pi SDK Integration
The agent-runner currently uses the Anthropic SDK directly for simplicity. When the Pi SDK (`@mariozechner/pi-coding-agent`) API is stable, swap the implementation in `agent-runner.ts`:
- Replace `Anthropic` client with `createAgentSession`
- Map Pi SDK events to the same JSONL format
- No Elixir-side changes needed — the JSONL protocol is the abstraction boundary.

### What's NOT in this plan (deferred to later phases)
- Agent chat LiveView (Phase 6 — real-time message streaming UI)
- Inter-agent message routing end-to-end test (Phase 4)
- Skills & tools deployment (Phase 5)
- Agent sleep/wake lifecycle
- Sprite destruction/cleanup
