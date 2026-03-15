# sprite-agents — Multi-Agent Orchestration Platform

## Context

A new Elixir/Phoenix project for orchestrating persistent AI agents. Each agent is a top-level entity with its own Sprite (persistent Linux VM from sprites.dev), mailbox, system prompt, skills, tools, and secrets. Agents communicate with each other and with users via a file-based mailbox protocol. The coordinator on the main VM manages agent lifecycle and routes messages between agents.

This is NOT a coding tool — agents are general-purpose and can perform any kind of work.

## Core Concepts

- **Agent** — persistent entity with a name, system prompt, skills, tools, secrets, and a Sprite VM
- **Sprite** — persistent Linux VM (sprites.dev) that hosts an agent. Filesystem survives sleep/wake cycles.
- **Mailbox** — file-based inbox/outbox on each Sprite for non-disruptive message queuing
- **Agent Runner** — Node.js daemon inside each Sprite that watches the mailbox and dispatches to the configured AI backend (Claude Code CLI, Pi, etc.)
- **Coordinator** — Elixir GenServer on the main VM that manages agent lifecycle and routes inter-agent messages
- **Skills** — files + prompt snippets deployed to the Sprite that extend agent capabilities
- **Tools** — MCP servers and CLI tools installed in the Sprite

## Architecture

```
Main VM (Phoenix)                          Sprite VMs
┌───────────────────────────┐
│ Web UI / API              │             ┌─────────────────────────┐
│   ↕                       │             │ Agent "alice"           │
│ Coordinator               │             │   /workspace/           │
│   ├─ AgentManager "alice" │─spawn/cmd─→ │     mailbox/inbox/      │
│   │    (receives stdout)  │← {:stdout}  │     mailbox/outbox/     │
│   │                       │             │     skills/             │
│   ├─ AgentManager "bob"   │─spawn/cmd─→ │     agent-runner.js     │
│   │    (receives stdout)  │← {:stdout}  │   claude / pi CLI       │
│   │                       │             └─────────────────────────┘
│   └─ routes agent↔agent   │
│                           │             ┌─────────────────────────┐
│ PubSub                    │             │ Agent "bob"             │
│   ↓                       │             │   /workspace/           │
│ LiveView / API consumers  │             │     mailbox/inbox/      │
└───────────────────────────┘             │     ...                 │
                                          └─────────────────────────┘
```

**Real-time output**: `Sprites.spawn` sends `{:stdout, cmd, data}` messages to the AgentManager — no polling needed for agent output.

**Input queuing**: Coordinator writes messages to Sprite inbox via `Sprites.cmd`. Agent runner picks them up via `fs.watch` — non-disruptive, queued.

---

## Data Model

### Agent schema (`agents` table)

```elixir
schema "agents" do
  field :name, :string              # unique, human-readable (e.g. "alice")
  field :sprite_name, :string       # Sprite VM identifier
  field :status, Ecto.Enum,
    values: [:created, :starting, :active, :sleeping, :failed, :destroyed]
  field :model, :string             # e.g. "sonnet", "opus"
  field :system_prompt, :string     # agent's system prompt
  # Skills and tools are managed directly on the Sprite filesystem via terminal

  has_many :secrets, SpriteAgents.Agents.Secret
  timestamps(type: :utc_datetime)
end
```

### Secret schema (`secrets` table)

```elixir
schema "secrets" do
  field :key, :string
  field :value, SpriteAgents.Encrypted.Binary  # AES-encrypted via Cloak
  belongs_to :agent, SpriteAgents.Agents.Agent
  timestamps(type: :utc_datetime)
end
```

---

## Phase 1: Project Scaffold + Agent CRUD

### 1.1 New Phoenix project

```bash
mix phx.new sprite_agents --database postgres
```

Add dependencies:
```elixir
{:sprites, git: "https://github.com/superfly/sprites-ex.git"},
{:cloak_ecto, "~> 1.3"},
{:cloak, "~> 1.1"},
{:jason, "~> 1.2"}
```

### 1.2 Agent schema + migration

Create `agents` and `secrets` tables. Agent context module (`lib/sprite_agents/agents.ex`) with CRUD:
- `list_agents/0`
- `get_agent!/1`
- `create_agent/1`
- `update_agent/2`
- `delete_agent/1`

### 1.3 API endpoints

REST API for agent CRUD:
- `GET /api/agents` — list agents
- `POST /api/agents` — create agent
- `GET /api/agents/:id` — get agent
- `PUT /api/agents/:id` — update agent
- `DELETE /api/agents/:id` — delete agent
- `POST /api/agents/:id/message` — send message to agent
- `GET /api/agents/:id/messages` — get message history

### 1.4 LiveView UI

Basic agent management UI:
- List agents with status
- Create/edit agent form (name, backend, model, system prompt, skills, tools, secrets)
- Agent chat view — send messages, see streamed responses

---

## Phase 2: Mailbox Protocol

### 2.1 Mailbox module (`lib/sprite_agents/mailbox.ex`)

Directory structure on each Sprite:
```
/workspace/mailbox/
  inbox/              # Coordinator writes here
  outbox/             # Agent writes here
  .inbox_seq
  .outbox_seq
```

Message filename: `{seq:06d}_{timestamp_ms}_{type}.json`

Message envelope:
```json
{
  "seq": 1,
  "ts": 1710500000000,
  "type": "user_message",
  "from": "coordinator",
  "payload": { "text": "Research competitor pricing" }
}
```

**Inbox types** (to agent):
- `user_message` — `{text}`
- `agent_message` — `{from_agent, text}`
- `set_model` — `{model}`
- `interrupt` — no payload
- `shutdown` — no payload
- `configure` — `{system_prompt, skills, tools}` (hot-reload config)

**Outbox types** (from agent, streamed via stdout):
- `text_delta` — `{delta}`
- `text` — `{text}`
- `tool_use_start` — `{name, input}`
- `tool_result` — `{name, output}`
- `turn_complete` — no payload
- `error` — `{message}`
- `agent_message` — `{to_agent, text}`
- `heartbeat` — `{status}`

Module functions:
- `write_message(sprite, :inbox, type, payload, opts)` — writes JSON via `Sprites.cmd`
- `encode/decode` — pure JSON helpers
- Atomic writes: `.tmp` then `mv`

### 2.2 Agent runner (`priv/sprite/agent-runner.ts`)

Bun + Pi TypeScript SDK daemon inside each Sprite. Uses `@mariozechner/pi-coding-agent` programmatically instead of spawning CLI subprocesses.

1. Watches `/workspace/mailbox/inbox/` via `fs.watch`
2. On `user_message`: dispatches to Pi SDK session
   ```typescript
   import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

   const { session } = await createAgentSession({
     sessionManager: SessionManager.inMemory(),
     authStorage: AuthStorage.create(),
     modelRegistry: new ModelRegistry(authStorage),
     cwd: "/workspace"
   });

   session.on("stream", (delta) => { /* emit JSONL to stdout */ });
   session.on("toolUse", (name, input) => { /* emit tool_use_start */ });
   await session.prompt(text);
   ```
3. Streams agent events as JSONL to stdout (captured by `Sprites.spawn`)
4. On `interrupt`: cancels active session
5. On `configure`: hot-reloads system prompt, writes skills files to `/workspace/skills/`
6. On `agent_message`: queues message, delivers when agent turn completes
7. Writes `heartbeat` to stdout every 30s

Reads config from `/workspace/agent-config.json` (written by coordinator at bootstrap):
```json
{
  "model": "sonnet",
  "system_prompt": "You are a research assistant...",
  "skills": [
    {"name": "web-research", "prompt": "When researching...", "files": ["research-template.md"]}
  ],
  "mcp_servers": [
    {"name": "browser", "command": "npx", "args": ["@anthropic/mcp-browser"]}
  ]
}
```

### 2.3 Bootstrap script (`priv/sprite/bootstrap.sh`)

```bash
#!/bin/bash
mkdir -p /workspace/{mailbox/inbox,mailbox/outbox,skills}
echo "0" > /workspace/mailbox/.inbox_seq
echo "0" > /workspace/mailbox/.outbox_seq
# agent-runner.ts and agent-config.json written by coordinator via Sprites.cmd
```

---

## Phase 3: AgentManager + Coordinator

### 3.1 AgentManager GenServer (`lib/sprite_agents/agent/agent_manager.ex`)

One per active agent, runs on main VM. Manages a single agent's Sprite lifecycle.

State:
```elixir
%{
  agent_id: integer(),
  agent_name: String.t(),
  sprite: Sprites.sprite(),
  command: Sprites.command() | nil,   # Sprites.spawn handle for agent runner
  phase: :starting | :bootstrapping | :active | :sleeping | :failed,
  pubsub_topic: String.t(),           # "agent:#{agent_name}"
  messages: list(),
  inbox_seq: integer()
}
```

Lifecycle:
1. **:starting** — `Sprites.create(client, "flyagents-#{agent_name}")`
2. **:bootstrapping** — run bootstrap.sh, write agent-config.json, write skill files, install CLI tools
3. **:active** — `Sprites.spawn` the agent runner, receive stdout messages, broadcast to PubSub

Handles:
- `send_message(name, text)` — writes `user_message` to inbox
- `interrupt(name)` — writes `interrupt` to inbox
- `configure(name, config)` — writes `configure` to inbox (hot-reload)
- `handle_info({:stdout, cmd, data})` — parses JSONL, broadcasts to PubSub
- `handle_info({:exit, cmd, code})` — agent runner exited, handle restart

### 3.2 Coordinator (`lib/sprite_agents/agent/coordinator.ex`)

Manages all agents. Responsibilities:
- Start/stop agents via DynamicSupervisor
- Route agent-to-agent messages
- Look up agents by name via `:pg` or Registry

```elixir
def start_agent(agent_name) do
  agent = Agents.get_agent_by_name!(agent_name)
  DynamicSupervisor.start_child(
    SpriteAgents.AgentSupervisor,
    {SpriteAgents.Agent.AgentManager, agent: agent}
  )
end

def send_message(agent_name, text, from \\ :user) do
  with {:ok, pid} <- lookup(agent_name) do
    AgentManager.send_message(pid, text, from)
  end
end

def route_agent_message(from_agent, to_agent, text) do
  with {:ok, pid} <- lookup(to_agent) do
    AgentManager.send_message(pid, text, {:agent, from_agent})
  end
end
```

### 3.3 Application supervision tree

```elixir
children = [
  SpriteAgentsWeb.Telemetry,
  SpriteAgents.Repo,
  SpriteAgents.Vault,
  {Phoenix.PubSub, name: SpriteAgents.PubSub},
  {Registry, keys: :unique, name: SpriteAgents.AgentRegistry},
  {DynamicSupervisor, name: SpriteAgents.AgentSupervisor, strategy: :one_for_one},
  SpriteAgents.Agent.Coordinator,
  SpriteAgentsWeb.Endpoint
]
```

---

## Phase 4: Agent-to-Agent Communication

When an agent's stdout contains an `agent_message` event:

```json
{"type": "agent_message", "payload": {"to_agent": "bob", "text": "Here's the analysis..."}}
```

AgentManager receives it via `{:stdout, cmd, data}`, calls:
```elixir
Coordinator.route_agent_message("alice", "bob", "Here's the analysis...")
```

Coordinator looks up "bob"'s AgentManager, which writes to bob's Sprite inbox. Bob's agent runner picks it up via `fs.watch` and delivers it to the AI backend as context.

The AI backends need to know about other agents. The agent runner includes available agent names in the system prompt or as a tool:
```
You can communicate with other agents using the send_message tool.
Available agents: alice, bob, charlie
```

---

## Phase 5: Skills & Tools Deployment

### 5.1 Skills

When an agent starts (or on `configure`), the AgentManager:
1. Reads skills from agent record
2. Writes skill files to `/workspace/skills/` via `Sprites.cmd`
3. Builds system prompt by combining base prompt + skill prompts
4. Writes complete config to `/workspace/agent-config.json`

### 5.2 Tools — CLI

CLI tools specified in `agent.tools.cli_tools` are installed during bootstrap:
```elixir
# In AgentManager bootstrap phase
for tool <- agent.tools["cli_tools"] do
  Sprites.cmd(sprite, "bash", ["-c", tool["install_command"]])
end
```

Example: `%{"name" => "ripgrep", "install_command" => "apt-get install -y ripgrep"}`

### 5.3 Tools — MCP Servers

MCP server configs are written to `/workspace/agent-config.json`. The agent runner starts them as child processes and configures the AI backend to use them.

For Claude Code CLI: MCP servers are configured via `~/.claude/settings.json` inside the Sprite.
For Pi: MCP config file in the workspace.

---

## Phase 6: Web UI (LiveView + React)

### 6.1 Pages

- **Agent list** — cards showing each agent's name, status, backend, model
- **Agent config** — form to edit name, system prompt, skills, tools, secrets, backend, model
- **Agent chat** — send messages to an agent, see streamed responses, see inter-agent messages
- **Dashboard** — overview of all agents, message routing visualization

### 6.2 LiveView ↔ Agent communication

LiveView subscribes to PubSub topic `"agent:#{agent_name}"`. AgentManager broadcasts:
- `{:status, status}` — agent status changes
- `{:agent_event, event}` — text deltas, tool use, errors, turn complete
- `{:agent_message, from, to, text}` — inter-agent messages (for visibility)

---

## Verification

1. **Mailbox unit tests** — encode/decode, parse_filename (pure functions)
2. **AgentManager tests** — mock Sprites module via Mox, verify correct command sequences per lifecycle phase
3. **Agent runner tests** — Node.js tests with mock agent CLI, verify inbox → stdout flow
4. **Coordinator tests** — test agent-to-agent routing, agent lookup, start/stop
5. **API tests** — Phoenix ConnTest for all REST endpoints
6. **Integration** — create real Sprite, bootstrap, send message, verify streamed response
7. **Multi-agent** — start two agents, have one message the other, verify delivery
