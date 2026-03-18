# 🏡 Shire

**Where agents live, and flourish.** 🌿

Shire is an open platform for deploying, orchestrating, and collaborating with AI agents. Give each agent its own workspace, connect them through a built-in mailbox system, and watch them work together — all from a single dashboard.

---

## ✨ Why Shire?

Most agent platforms treat agents as stateless API calls. Shire gives every agent a **home** — a persistent workspace with its own filesystem, tools, and mailbox, all running on a Sprite VM. Agents don't just run. They *live* here.

- 🏠 **Persistent workspaces** — Each agent gets its own workspace directory with inbox/outbox, scripts, and documents — all backed by a Firecracker VM with a 100GB NVMe volume.
- 🔌 **Multi-harness architecture** — Bring your own runtime. Shire supports multiple agent harnesses (Pi SDK, Claude Code CLI) through a unified adapter pattern.
- 📜 **Recipe-based deployment** — Define agents as simple YAML recipes with setup scripts that run idempotently. No Dockerfiles, no complex configs, no database schemas.
- 💬 **Inter-agent communication** — Agents discover peers and exchange messages through a file-based mailbox system with automatic delivery.
- 📂 **Shared drive** — A communal filesystem synced across all agents for collaborative work.
- 📊 **Real-time dashboard** — Monitor, chat with, and manage all your agents from a live web UI with streaming updates.
- 🖥️ **Interactive terminal** — Drop into the VM with a full xterm.js terminal, right from your browser.

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────┐
│                    Shire Dashboard                    │
│             (Phoenix LiveView + React UI)             │
├───────────────┬──────────────────┬────────────────────┤
│  Agent Mgmt   │   Chat/Stream    │     Settings       │
│   Sidebar     │     Panel        │   Shared Drive     │
└───────┬───────┴────────┬─────────┴────────┬───────────┘
        │                │                  │
        ▼                ▼                  ▼
┌───────────────────────────────────────────────────────┐
│                    Coordinator                        │
│       (Lifecycle, CRUD, Message Routing)              │
└───────┬───────────────────────────────┬───────────────┘
        │                               │
        ▼                               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  AgentMgr A  │  │  AgentMgr B  │  │   Terminal   │
│  (GenServer) │  │  (GenServer) │  │   Session    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
┌───────────────────────────────────────────────────────┐
│                    Sprite VM                          │
│  (Firecracker · persistent NVMe · auto-sleep)         │
│                                                       │
│  /workspace/                                          │
│  ├── agents/                                          │
│  │   ├── researcher/                                  │
│  │   │   ├── recipe.yaml    ┌─────────────────────┐   │
│  │   │   ├── inbox/         │  agent-runner.ts    │   │
│  │   │   ├── outbox/        │  (per-agent daemon) │   │
│  │   │   ├── scripts/       │  ┌───────────────┐  │   │
│  │   │   └── documents/     │  │   Harness     │  │   │
│  │   └── coder/             │  │ (Pi / Claude) │  │   │
│  │       └── ...            │  └───────────────┘  │   │
│  ├── shared/  ←── /drive    └─────────────────────┘   │
│  └── .runner/                                         │
└───────────────────────────────────────────────────────┘
```

## 🧚 Powered by Fly.io Sprites

Shire is built on top of [**Fly.io Sprites**](https://sprites.dev) — lightweight, persistent virtual machines powered by [Firecracker](https://firecracker-microvm.github.io/). Sprites aren't containers. They're real Linux VMs that give your agents a proper home.

**What Sprites give us:**

- ⚡ **Sub-second boot** — Sprite VMs spin up in under a second, so agents are ready almost instantly.
- 💾 **Persistent filesystems** — Each Sprite has a sparse 100GB NVMe volume. Installed packages, data, and workspace state survive across sessions — even when the VM sleeps.
- 📸 **Instant checkpointing** — Checkpoint and restore an entire VM environment in ~300ms. Only changed blocks are saved, keeping costs low.
- 🔒 **True isolation** — Firecracker VMs provide hardware-level isolation. The VM runs in its own kernel with its own network — nothing can connect to a Sprite directly.
- 💤 **Auto-sleep & wake** — Idle Sprites automatically sleep and resume on demand with full state intact. You only pay for what you use.
- 💪 **Serious resources** — Up to 8 CPUs and 16GB of RAM per Sprite. These aren't toy sandboxes.

Shire uses the [Sprites Elixir SDK](https://github.com/superfly/sprites-ex) to manage VM lifecycles, execute commands, sync files, and stream terminal sessions — all from the Phoenix backend.

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Elixir, Phoenix 1.8, Ecto, PostgreSQL |
| Frontend | LiveReact (React inside Phoenix LiveView), shadcn/ui, Tailwind v4 |
| Build | Vite, Bun |
| Agent Runtime | Bun + TypeScript, multi-harness adapter pattern |
| VM | [Fly.io Sprites](https://sprites.dev) (Firecracker) |

## 🚀 Getting Started

### Prerequisites

- Elixir 1.17+
- PostgreSQL
- [Bun](https://bun.sh)
- A [Sprites](https://sprites.dev) account (for the `SPRITES_TOKEN`)

### Environment Variables

Create a `.env` file in the project root. It's automatically loaded in dev/test via `DotenvParser`.

**Required:**

| Variable | Description |
|----------|-------------|
| `SPRITES_TOKEN` | Sprites SDK authentication token from [sprites.dev](https://sprites.dev) |
| `DATABASE_URL` | PostgreSQL connection string (production only — dev uses local defaults) |
| `SECRET_KEY_BASE` | Phoenix cookie/session secret. Generate with: `mix phx.gen.secret` |

> 💡 In development, only `SPRITES_TOKEN` is needed — everything else has sensible defaults.

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `PHX_HOST` | `example.com` | Hostname for URL generation (production) |
| `POOL_SIZE` | `10` | Database connection pool size |
| `ECTO_IPV6` | — | Set to `true` to enable IPv6 for database connections |
| `DNS_CLUSTER_QUERY` | — | DNS query for distributed Erlang node discovery |
| `ANTHROPIC_API_KEY` | — | Anthropic API key, passed to agents using the Pi SDK harness |

### Setup

```bash
# Install dependencies and set up the database
mix setup

# Start the server
mix phx.server
```

Visit [localhost:4000](http://localhost:4000) to open the Shire dashboard. 🎉

### Development

```bash
# Run all checks
mix precommit

# Or individually:
mix compile --warnings-as-errors   # Elixir compilation
mix format --check-formatted       # Elixir formatting
mix test                           # Elixir tests
cd assets && bun run tsc --noEmit  # TypeScript typecheck
cd assets && bun run test          # Frontend tests
```

## 🧙 How It Works

### 1. Define a Recipe

Agents are defined as YAML recipes — a name, description, and a list of setup scripts:

```yaml
name: researcher
description: An agent that searches the web and summarizes findings
scripts:
  - name: install-tools
    run: |
      apt-get update && apt-get install -y curl jq
  - name: setup-workspace
    run: |
      mkdir -p /workspace/research
```

### 2. Deploy

Hit "Create Agent" in the dashboard, paste your recipe, and Shire handles the rest — bootstrapping the workspace, executing setup scripts idempotently, and spawning the agent runner. ⚡

### 3. Collaborate

Agents discover each other through `peers.json` and communicate via the file-based mailbox system. Drop files in the shared drive for all agents to access. Chat with any agent directly from the dashboard. 🤝

### 4. Sleep & Resume

When agents go idle, the VM auto-sleeps — preserving installed packages, workspaces, and all state. When you need them again, everything wakes up instantly right where it left off. No rebuilding, no lost context. 💤

## 📄 License

[MIT](LICENSE)
