# Shire

**Agents that work with you, not for you.**

[agents-shire.sh](https://www.agents-shire.sh/)

Most AI tools let you assign a task and walk away. Shire gives you a team of AI agents you actually work alongside — they persist, they communicate, they pick up where they left off. Open source.

![Shire Dashboard](docs/screenshot.png)

## See it in action

https://github.com/user-attachments/assets/04056f61-d2e7-4eb8-b0e4-48a342b298d3

---

## Why Shire?

Most AI agent tools follow the same pattern — you give an instruction, an agent executes it, you get the output. The agent disappears. Next time, you start from scratch. Shire is different. Your agents persist between sessions. They communicate with each other autonomously. They build on yesterday's work. You give feedback, iterate, adjust direction — like working with a real team.

- **Run locally or in the cloud** — Get started on your own machine in seconds with zero configuration. Scale to isolated cloud VMs ([Fly.io Sprites](https://sprites.dev)) or any Linux VPS via SSH when you're ready.
- **Works with any model** — Not locked to one AI provider. Supports Claude Code, Pi Agent, and more coming soon. Shire is the infrastructure layer — bring whatever model fits your workflow.
- **Autonomous agent communication** — Agents discover peers and collaborate on their own — no orchestrator required. Direct messaging, shared context, real teamwork between agents.
- **Agent catalog** — Browse and deploy from a community-maintained library of pre-built agents. Powered by [agency-agents](https://github.com/msitarzewski/agency-agents). Get a capable team running in seconds.
- **Shared drive** — A communal filesystem synced across all agents for collaborative work on shared artifacts.
- **Scheduled tasks** — Automate agent work with one-time or recurring scheduled messages. Set custom intervals and let agents run on autopilot.
- **Multi-project architecture** — Organize agents into projects, each with its own dedicated VM, shared drive, and settings.
- **Recipe-based deployment** — Define agents as simple YAML recipes. No Dockerfiles, no complex configs.
- **Real-time dashboard** — Monitor, chat with, and manage agents from a live web UI with streaming updates.
- **Interactive terminal** — Drop into the VM with a full terminal, right from your browser.

## Architecture

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
│  {workspace_root}/           │  │  {workspace_root}/           │
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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Elixir, Phoenix 1.8, Ecto, SQLite (default) / PostgreSQL |
| Frontend | LiveReact (React inside Phoenix LiveView), shadcn/ui, Tailwind v4 |
| Build | Vite, Bun |
| Agent Runtime | Bun + TypeScript, multi-harness adapter pattern |
| VM | Pluggable: Local (default), [Fly.io Sprites](https://sprites.dev) (Firecracker), or SSH (any VPS) |
| Job Processing | [Oban](https://getoban.pro/) (scheduled tasks, recurring jobs) |

## Getting Started

### Prerequisites

- Elixir 1.18+ / Erlang OTP 27+ (or run `asdf install` from `.tool-versions`)
- [Bun](https://bun.sh)
- [Claude Code](https://claude.ai/download) (for running agents locally)

### Quick Start

No `.env` file needed. No database to install. Just three commands:

```bash
git clone https://github.com/victor36max/shire.git && cd shire
mix setup        # Install deps, create SQLite DB, build assets
mix phx.server   # Start the server
```

Visit [localhost:4000](http://localhost:4000) to open the dashboard.

By default, Shire uses **SQLite** for storage and **local mode** for agent execution. Agents run as local processes on your machine — no VMs, no SSH, no tokens. All data is stored at `~/.shire/`.

### VM Backend Options

Shire auto-detects the VM backend from your environment. Override with `SHIRE_VM_TYPE` or set credentials in a `.env` file.

#### Local (default)

Active out of the box when no cloud credentials are set. Agents run as local processes using Erlang ports.

- Workspaces: `~/.shire/projects/{project_id}/`
- Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/download) installed on your machine
- No bootstrap, no VMs, no SSH

#### Sprites (Firecracker VMs)

Production-grade backend using [Fly.io Sprites](https://sprites.dev) — lightweight Firecracker VMs with sub-second boot, persistent storage, and auto-sleep.

**What you need:** A Sprites account and token from [sprites.dev](https://sprites.dev).

```bash
SPRITES_TOKEN=your_token_here
```

Shire uses the [Sprites Elixir SDK](https://github.com/superfly/sprites-ex) to manage VM lifecycles, execute commands, and stream terminal sessions.

**Highlights:**
- Sub-second VM boot times
- Persistent 100GB NVMe storage per VM
- Instant checkpointing and restore (~300ms)
- Auto-sleep on idle, instant resume
- Hardware-level isolation via Firecracker
- Up to 8 CPUs / 16GB RAM per VM

#### SSH (Any VPS)

Connect to any Linux VPS over SSH. Run agents on your own infrastructure.

**What you need:** A Linux VPS with SSH access. Bun and Claude Code are installed automatically during bootstrap.

```bash
SHIRE_VM_TYPE=ssh
SHIRE_SSH_HOST=your-server.example.com
SHIRE_SSH_USER=deploy

# Key-based auth (recommended):
SHIRE_SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"

# Or password-based auth:
# SHIRE_SSH_PASSWORD=your_password

# Optional:
# SHIRE_SSH_PORT=22
# SHIRE_SSH_WORKSPACE_ROOT=/home/deploy/shire/projects
```

Shire creates workspace directories on the remote host automatically.

### Optional: Use PostgreSQL

By default Shire uses SQLite — no database server needed. To use PostgreSQL instead, set `SHIRE_DB=postgres` at compile time:

```bash
SHIRE_DB=postgres mix setup
SHIRE_DB=postgres mix phx.server
```

In production with PostgreSQL, set `DATABASE_URL`:

```bash
DATABASE_URL=ecto://USER:PASS@HOST/DATABASE
```

---

## Environment Variables

Full reference. Create a `.env` file in the project root — it's automatically loaded in dev/test via `DotenvParser`.

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `PHX_HOST` | `example.com` | Hostname for URL generation (production) |
| `SECRET_KEY_BASE` | — | Phoenix session secret. Generate with `mix phx.gen.secret` |
| `SHIRE_DB` | `sqlite` | Database engine: `sqlite` or `postgres` (compile-time) |
| `DATABASE_PATH` | `~/.shire/shire_prod.db` | SQLite database path (production, SQLite only) |
| `DATABASE_URL` | — | PostgreSQL connection string (production, PostgreSQL only) |
| `POOL_SIZE` | `5` (SQLite) / `10` (PostgreSQL) | Database connection pool size |
| `ECTO_IPV6` | — | Set to `true` for IPv6 database connections (PostgreSQL only) |
| `DNS_CLUSTER_QUERY` | — | DNS query for distributed Erlang node discovery |

### VM Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `SHIRE_VM_TYPE` | auto-detected | VM backend: `local`, `sprites`, or `ssh`. Auto-detects from credentials if not set. |
| `SPRITES_TOKEN` | — | Sprites SDK token (required for Sprites backend) |
| `SHIRE_SSH_HOST` | — | SSH hostname (required for SSH backend) |
| `SHIRE_SSH_USER` | — | SSH username (required for SSH backend) |
| `SHIRE_SSH_KEY` | — | Raw PEM private key content (SSH backend) |
| `SHIRE_SSH_PASSWORD` | — | SSH password, alternative to `SHIRE_SSH_KEY` (SSH backend) |
| `SHIRE_SSH_PORT` | `22` | SSH port |
| `SHIRE_SSH_WORKSPACE_ROOT` | `/home/$SHIRE_SSH_USER/shire/projects` | Workspace root on remote host |

Agent-specific env vars (API keys, tokens, etc.) are configured per-project via the Settings page, not as server-level environment variables.

## How It Works

### 1. Deploy

Run locally with zero config, or set up [Fly.io Sprites](https://sprites.dev) (Firecracker) or any Linux VPS via SSH for production. Projects are the top-level unit; each gets its own VM with isolated storage.

### 2. Build Your Team

Pick agents from the community catalog or create your own with simple YAML recipes:

```yaml
name: researcher
description: An agent that searches the web and summarizes findings
harness: claude_code
model: sonnet
system_prompt: |
  You are a research assistant. Search the web and summarize findings.
```

Recipe fields: `name`, `description`, `harness` (`claude_code` or `pi_sdk`), `model`, `system_prompt`, and `skills`.

### 3. Collaborate

Work alongside your agents — give feedback, adjust direction. Agents discover each other through `peers.yaml` and exchange messages autonomously via the mailbox system. Use the shared drive for files all agents need. Schedule recurring messages on custom intervals. Chat with any agent from the dashboard.

### 4. Sleep & Resume

When you're done for the day, agents sleep preserving all state. Come back tomorrow — they wake in ~300ms, right where you left off. No context lost. *(Sprites backend only — SSH and Local backends are always-on.)*

## Development

```bash
# Run all checks
mix precommit

# Or individually:
mix compile --warnings-as-errors   # Elixir compilation
mix format --check-formatted       # Elixir formatting
mix test                           # Elixir tests
cd assets && bun run tsc --noEmit  # TypeScript typecheck
cd assets && bun run lint          # ESLint
cd assets && bun run format:check  # Prettier
cd assets && bun run test          # Frontend tests
```

## License

[Business Source License 1.1](LICENSE) — free for non-production use. Converts to Apache 2.0 on 2030-03-24.
