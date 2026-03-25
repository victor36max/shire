# 🏡 Shire

**Where agents live, and flourish.** 🌿

Shire is an open platform for deploying, orchestrating, and collaborating with AI agents. Give each agent its own workspace, connect them through a built-in mailbox system, and watch them work together — all from a single dashboard.

![Shire Dashboard](docs/screenshot.png)

---

## ✨ Why Shire?

Most agent platforms treat agents as stateless API calls. Shire gives every agent a **home** — a persistent workspace with its own filesystem, tools, and mailbox. Agents don't just run. They *live* here.

- 📁 **Multi-project architecture** — Organize agents into projects, each with its own dedicated VM, shared drive, and settings. Spin up as many isolated environments as you need.
- 🏠 **Persistent workspaces** — Each agent gets its own workspace directory with inbox/outbox, scripts, and documents — backed by a Firecracker VM, remote VPS via SSH, or local filesystem.
- 🌐 **SSH VM backend** — Connect to any VPS over SSH. Run agents on your own infrastructure with key-based authentication and SFTP file operations.
- 🔌 **Multi-harness architecture** — Bring your own runtime. Shire supports multiple agent harnesses (Pi SDK, Claude Code CLI) through a unified adapter pattern.
- 📜 **Recipe-based deployment** — Define agents as simple YAML recipes with setup scripts that run idempotently. No Dockerfiles, no complex configs.
- 📚 **Agent catalog** — Browse and deploy agents from a built-in catalog of pre-built templates organized by category (design, marketing, engineering, and more).
- 💬 **Inter-agent communication** — Agents discover peers and exchange messages through a file-based mailbox system with automatic delivery.
- ⏰ **Scheduled tasks** — Automate agent work with one-time or recurring scheduled messages — hourly, daily, weekly, monthly, or custom intervals.
- 📂 **Shared drive** — A communal filesystem synced across all agents within a project for collaborative work.
- 📊 **Real-time dashboard** — Monitor, chat with, and manage all your agents from a live web UI with streaming updates.
- 🖥️ **Interactive terminal** — Drop into the VM with a full xterm.js terminal, right from your browser.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Shire Dashboard                       │
│                (Phoenix LiveView + React UI)                │
├─────────────────────────────────────────────────────────────┤
│  ProjectDashboard (/)                                       │
│  ├── AgentDashboard (/projects/:name)                       │
│  │   ├── Agent Sidebar  │  Chat/Stream Panel                │
│  ├── Project Details (/projects/:name/details)              │
│  ├── Settings (/projects/:name/settings)                    │
│  ├── Schedules (/projects/:name/schedules)                  │
│  └── Shared Drive (/projects/:name/shared)                  │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  ProjectManager (GenServer)                 │
│             Boots all project VMs on startup                │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  Project A                   │  │  Project B                   │
│  (ProjectInstanceSupervisor) │  │  (ProjectInstanceSupervisor) │
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │
│  │ VM (Sprite/SSH/Local)  │  │  │  │ VM (Sprite/SSH/Local)  │  │
│  │ Coordinator            │  │  │  │ Coordinator            │  │
│  │ AgentMgr A, B, ...     │  │  │  │ AgentMgr C, D, ...     │  │
│  │ Terminal Session       │  │  │  │ Terminal Session       │  │
│  └────────────────────────┘  │  │  └────────────────────────┘  │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               │                                 │
               ▼                                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  VM (A)                      │  │  VM (B)                      │
│  Sprite, SSH, or Local       │  │  Sprite, SSH, or Local       │
│                              │  │                              │
│  {workspace_root}/             │  │  {workspace_root}/             │
│  ├── agents/                 │  │  ├── agents/                 │
│  │   ├── researcher/         │  │  │   └── ...                 │
│  │   │   ├── recipe.yaml     │  │  ├── shared/                 │
│  │   │   ├── inbox/          │  │  └── .runner/                │
│  │   │   ├── outbox/         │  └──────────────────────────────┘
│  │   │   ├── scripts/        │
│  │   │   └── documents/      │
│  │   └── coder/              │
│  ├── shared/                 │
│  └── .runner/                │
└──────────────────────────────┘
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

> 💡 **Alternative backends:** Don't have a Sprites account? Set `SHIRE_VM_TYPE=ssh` to connect to any VPS over SSH, or `SHIRE_VM_TYPE=local` to use a local filesystem backend. Agent workspaces live at `~/.shire/projects/` in local mode and processes run as local Erlang ports.

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Elixir, Phoenix 1.8, Ecto, PostgreSQL |
| Frontend | LiveReact (React inside Phoenix LiveView), shadcn/ui, Tailwind v4 |
| Build | Vite, Bun |
| Agent Runtime | Bun + TypeScript, multi-harness adapter pattern |
| VM | Pluggable: [Fly.io Sprites](https://sprites.dev) (Firecracker), SSH (any VPS), or Local (dev) |
| Job Processing | [Oban](https://getoban.pro/) (scheduled tasks, recurring jobs) |

## 🚀 Getting Started

### Prerequisites

- Elixir 1.15+
- PostgreSQL
- [Bun](https://bun.sh)
- A [Sprites](https://sprites.dev) account (for the `SPRITES_TOKEN`) — optional if using the SSH or local VM backend

### Environment Variables

Create a `.env` file in the project root. It's automatically loaded in dev/test via `DotenvParser`.

**Required:**

| Variable | Description |
|----------|-------------|
| `SPRITES_TOKEN` | Sprites SDK authentication token from [sprites.dev](https://sprites.dev) (not needed with SSH or local VM backend) |
| `DATABASE_URL` | PostgreSQL connection string (production only — dev uses local defaults) |
| `SECRET_KEY_BASE` | Phoenix cookie/session secret. Generate with: `mix phx.gen.secret` |

> 💡 In development with local VM backend (`SHIRE_VM_TYPE=local`), no external tokens are needed. The SSH backend (`SHIRE_VM_TYPE=ssh`) requires `SHIRE_SSH_HOST`, `SHIRE_SSH_USER`, and `SHIRE_SSH_KEY`. With Sprite VMs, only `SPRITES_TOKEN` is required.

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `PHX_HOST` | `example.com` | Hostname for URL generation (production) |
| `POOL_SIZE` | `10` | Database connection pool size |
| `ECTO_IPV6` | — | Set to `true` to enable IPv6 for database connections |
| `DNS_CLUSTER_QUERY` | — | DNS query for distributed Erlang node discovery |
| `ANTHROPIC_API_KEY` | — | Anthropic API key, passed to agents using the Pi SDK harness |
| `SHIRE_VM_TYPE` | `sprites` | VM backend: `sprites` (Firecracker), `ssh` (any VPS), or `local` (local filesystem for dev) |
| `SHIRE_SSH_HOST` | — | SSH hostname (required when `SHIRE_VM_TYPE=ssh`) |
| `SHIRE_SSH_USER` | — | SSH username (required when `SHIRE_VM_TYPE=ssh`) |
| `SHIRE_SSH_KEY` | — | Raw SSH private key PEM content (one of `SHIRE_SSH_KEY` or `SHIRE_SSH_PASSWORD` required when `SHIRE_VM_TYPE=ssh`) |
| `SHIRE_SSH_PASSWORD` | — | SSH password (alternative to `SHIRE_SSH_KEY`) |
| `SHIRE_SSH_PORT` | `22` | SSH port |
| `SHIRE_SSH_WORKSPACE_ROOT` | `/home/$SHIRE_SSH_USER/shire/projects` | Workspace root on the remote host |

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

### 1. Create a Project

Projects are the top-level unit in Shire. Each project gets its own dedicated VM (Sprite, SSH, or Local) with isolated storage and networking. Create one from the dashboard at `/`. 📁

### 2. Define a Recipe

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

### 3. Deploy

Navigate into your project, hit "Create Agent", paste your recipe or pick one from the built-in catalog, and Shire handles the rest — bootstrapping the workspace, executing setup scripts idempotently, and spawning the agent runner. ⚡

### 4. Collaborate

Agents within a project discover each other through `peers.yaml` and communicate via the file-based mailbox system. Drop files in the shared drive for all agents in the project to access. Chat with any agent directly from the dashboard. 🤝

### 5. Automate

Set up scheduled tasks to send messages to agents on a recurring basis — hourly, daily, weekly, or custom intervals. Great for periodic reports, health checks, or automated workflows. ⏰

### 6. Sleep & Resume

When agents go idle, the VM auto-sleeps — preserving installed packages, workspaces, and all state. When you need them again, everything wakes up instantly right where it left off. No rebuilding, no lost context. 💤

## 📄 License

[Business Source License 1.1](LICENSE) — free for non-production use. Converts to Apache 2.0 on 2030-03-24.
