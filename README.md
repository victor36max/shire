# Shire

**Where agents live, and flourish.**

Shire is an open platform for deploying, orchestrating, and collaborating with AI agents. Give each agent its own persistent workspace, connect them through a built-in mailbox system, and manage everything from a single dashboard.

![Shire Dashboard](docs/screenshot.png)

---

## Why Shire?

Most agent platforms treat agents as stateless API calls. Shire gives every agent a **home** — a persistent workspace with its own filesystem, tools, and mailbox.

- **Multi-project architecture** — Organize agents into projects, each with its own dedicated VM, shared drive, and settings.
- **Persistent workspaces** — Each agent gets its own directory with inbox/outbox, scripts, and documents — backed by a Firecracker VM, remote VPS, or local filesystem.
- **Pluggable VM backends** — Run on [Fly.io Sprites](https://sprites.dev) (Firecracker), any VPS via SSH, or your local machine for development.
- **Multi-harness runtime** — Bring your own agent runtime. Supports Pi SDK and Claude Code CLI through a unified adapter pattern.
- **Recipe-based deployment** — Define agents as simple YAML recipes. No Dockerfiles, no complex configs.
- **Agent catalog** — Browse and deploy from a built-in catalog of pre-built agent templates.
- **Inter-agent communication** — Agents discover peers and exchange messages through a file-based mailbox system.
- **Scheduled tasks** — Automate agent work with one-time or recurring messages on custom intervals.
- **Shared drive** — A communal filesystem synced across all agents within a project.
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
| Backend | Elixir, Phoenix 1.8, Ecto, PostgreSQL |
| Frontend | LiveReact (React inside Phoenix LiveView), shadcn/ui, Tailwind v4 |
| Build | Vite, Bun |
| Agent Runtime | Bun + TypeScript, multi-harness adapter pattern |
| VM | Pluggable: [Fly.io Sprites](https://sprites.dev) (Firecracker), SSH (any VPS), or Local (dev) |
| Job Processing | [Oban](https://getoban.pro/) (scheduled tasks, recurring jobs) |

## Getting Started

### Prerequisites

- Elixir 1.15+
- PostgreSQL
- [Bun](https://bun.sh)

### 1. Set up the database

Shire requires PostgreSQL. In development, `mix setup` creates the database automatically using local defaults. In production, set `DATABASE_URL` via your secrets manager or environment.

### 2. Choose a VM backend

Shire needs a VM backend for agent workspaces. Configure via environment variables (`.env` in dev, secrets manager in production):

#### 🔥 Option A: Sprites (Firecracker VMs)

Production-grade backend using [Fly.io Sprites](https://sprites.dev) — lightweight Firecracker VMs with sub-second boot, persistent storage, and auto-sleep.

**What you need:** A Sprites account and token from [sprites.dev](https://sprites.dev).

```bash
SPRITES_TOKEN=your_token_here
```

Sprites is the default backend — no other configuration needed.

Shire uses the [Sprites Elixir SDK](https://github.com/superfly/sprites-ex) to manage VM lifecycles, execute commands, and stream terminal sessions.

**Highlights:**
- Sub-second VM boot times
- Persistent 100GB NVMe storage per VM
- Instant checkpointing and restore (~300ms)
- Auto-sleep on idle, instant resume
- Hardware-level isolation via Firecracker
- Up to 8 CPUs / 16GB RAM per VM

#### 🖥️ Option B: SSH (Any VPS)

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

#### 💻 Option C: Local (Development)

Use the local filesystem. Ideal for development and testing.

**What you need:** [Bun](https://bun.sh) and [Claude Code](https://claude.ai/download) installed on your machine (bootstrap does not run in local mode).

```bash
SHIRE_VM_TYPE=local
```

Agent workspaces live at `~/.shire/projects/`. Processes run as local Erlang ports — no VMs, no SSH, no tokens.

### 3. Install and run

```bash
mix setup        # Install deps, create DB, build assets
mix phx.server   # Start the server
```

Visit [localhost:4000](http://localhost:4000) to open the dashboard.

---

## Environment Variables

Full reference. Create a `.env` file in the project root — it's automatically loaded in dev/test via `DotenvParser`.

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `PHX_HOST` | `example.com` | Hostname for URL generation (production) |
| `SECRET_KEY_BASE` | — | Phoenix session secret. Generate with `mix phx.gen.secret` |
| `DATABASE_URL` | — | PostgreSQL connection string (production only — dev uses local defaults) |
| `POOL_SIZE` | `10` | Database connection pool size |
| `ECTO_IPV6` | — | Set to `true` for IPv6 database connections |
| `DNS_CLUSTER_QUERY` | — | DNS query for distributed Erlang node discovery |

### VM Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `SHIRE_VM_TYPE` | `sprites` | VM backend: `sprites`, `ssh`, or `local` |
| `SPRITES_TOKEN` | — | Sprites SDK token (required for Sprites backend) |
| `SHIRE_SSH_HOST` | — | SSH hostname (required for SSH backend) |
| `SHIRE_SSH_USER` | — | SSH username (required for SSH backend) |
| `SHIRE_SSH_KEY` | — | Raw PEM private key content (SSH backend) |
| `SHIRE_SSH_PASSWORD` | — | SSH password, alternative to `SHIRE_SSH_KEY` (SSH backend) |
| `SHIRE_SSH_PORT` | `22` | SSH port |
| `SHIRE_SSH_WORKSPACE_ROOT` | `/home/$SHIRE_SSH_USER/shire/projects` | Workspace root on remote host |

Agent-specific env vars (API keys, tokens, etc.) are configured per-project via the Settings page, not as server-level environment variables.

## How It Works

### 1. Create a Project

Projects are the top-level unit. Each project gets its own VM with isolated storage. Create one from the dashboard.

### 2. Define a Recipe

Agents are defined as YAML recipes:

```yaml
name: researcher
description: An agent that searches the web and summarizes findings
harness: claude_code
model: sonnet
system_prompt: |
  You are a research assistant. Search the web and summarize findings.
```

Recipe fields: `name`, `description`, `harness` (`claude_code` or `pi_sdk`), `model`, `system_prompt`, and `skills`.

### 3. Deploy

Hit "Create Agent", paste your recipe or pick one from the catalog. Shire bootstraps the workspace and spawns the agent runner.

### 4. Collaborate

Agents discover each other through `peers.yaml` and exchange messages via the mailbox system. Use the shared drive for files all agents need. Chat with any agent from the dashboard.

### 5. Automate

Schedule recurring messages to agents — hourly, daily, weekly, or custom cron intervals.

### 6. Sleep & Resume

Idle VMs auto-sleep, preserving all state. Everything resumes instantly when needed. *(Sprites backend only — SSH and Local backends are always-on.)*

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
