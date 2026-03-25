# Shire

## Tech Stack

- **Backend:** Elixir / Phoenix 1.8 / Ecto / PostgreSQL
- **Frontend:** LiveReact (React components inside Phoenix LiveView) + shadcn/ui (Radix + Tailwind v4)
- **Build:** Vite (not esbuild), Bun (not npm/node)
- **CSS:** Tailwind v4 with `@theme inline` + oklch CSS variables (shadcn default)
- **VM:** Pluggable VM backend via `VirtualMachine` behaviour — `VirtualMachineSprite` (Firecracker) for production, `VirtualMachineSSH` (SSH to any VPS) for remote servers, `VirtualMachineLocal` (local filesystem + Erlang ports) for development. Selected via `SHIRE_VM_TYPE` env var.
- **Agent runtime:** Bun + multi-harness adapter pattern (Pi SDK, Claude Code CLI)
- **Agent deployment:** Recipe-based (YAML recipes on the VM filesystem, no DB schema)
- **Agent catalog:** Static YAML agent templates in `priv/catalog/agents/`, read on demand by `Shire.Catalog`
- **Scheduled tasks:** Oban-based job processing for recurring/one-time automated agent messaging
- **Inter-agent comms:** File-based inbox/outbox directories + `fs.watch` in `agent-runner.ts` + peer discovery via `peers.yaml`
- **Shared drive:** Shared filesystem synced to all agents at `{workspace_root}/shared/` (also mounted at `/drive` on Sprite VMs)

## Architecture: LiveView + React Split

**LiveView handles server-side state only:**
- Data fetching, CRUD operations, assigns
- `handle_event` callbacks for mutations
- Renders a single `<.react name="PageComponent" ...props />` per page

**React handles all client-side UI state:**
- Dialog/modal open/close (instant, no server roundtrip)
- Form state, editing IDs, delete confirmations
- Layout and rendering via shadcn/ui components

**Key patterns:**
- One page-level React component per LiveView (e.g., `AgentDashboard`, `AgentShow`, `SettingsPage`, `SharedDrive`, `SchedulesPage`, `ProjectDetailsPage`)
- React receives `pushEvent` as a prop from LiveReact to send events back to LiveView
- Use specific event names like `create-agent`, `update-agent` instead of generic `save` (avoids dependency on `live_action`)
- Shared `AppLayout` component wraps all pages with consistent padding/max-width
- The Elixir `app` layout is a passthrough — layout is handled in React

## Key Concepts

**Projects** — DB-backed (`projects` table, UUID PK). Each project owns one VM (Sprite, SSH, or Local) and a set of agents. `ProjectManager` boots all project VMs on startup.

**Supervision tree:**
- `ProjectManager` → `ProjectInstanceSupervisor` (per project, `one_for_all`) → `[VM module, Coordinator, DynamicSupervisor]`
- VM module is selected at runtime via config (`VirtualMachineSprite`, `VirtualMachineSSH`, or `VirtualMachineLocal`)
- Registries: `AgentRegistry` (agents by name), `ProjectRegistry` (project supervisors by ID)

**VM backends:**
- `VirtualMachineSprite` — Production backend using Fly.io Sprites (Firecracker VMs). Workspace at `/workspace`.
- `VirtualMachineSSH` — SSH backend for connecting to any VPS. Uses SSH key-based auth (via `KeyCb` callback) + SFTP for filesystem operations. Workspace root configurable via `SHIRE_SSH_WORKSPACE_ROOT`.
- `VirtualMachineLocal` — Development backend using local filesystem (`~/.shire/projects/{project_id}/`) + Erlang ports for process execution.
- All implement the `Shire.VirtualMachine` behaviour. `Shire.Workspace` delegates path resolution to the configured backend.
- `VirtualMachine.Setup` — Shared setup logic (bootstrap + runner deployment) used by all backends during init.

**Recipes** — YAML files defining agents (`name`, `description`, `harness`, `scripts`). Live on the VM at `{workspace_root}/agents/{id}/recipe.yaml` — no DB schema for recipes. Agents themselves are DB-backed with a unique constraint on `(project_id, name)`.

**Catalog** — YAML agent templates in `priv/catalog/agents/` organized by category. Populated by `mix catalog.sync` (gitignored, not checked in). `Shire.Catalog` reads them on demand — no GenServer, no DB schema. Categories defined in `priv/catalog/categories.yaml`.

**Agent lifecycle:**
- `Coordinator` handles per-project agent CRUD — writes `recipe.yaml` to VM, starts `AgentManager` under `DynamicSupervisor`
- `AgentManager` bootstraps workspace dirs (inbox, outbox, scripts, documents, attachments/outbox, .claude/skills), writes `INTERNAL.md` system prompt, deploys skills, spawns `agent-runner.ts`

**File attachments** — Agents can send and receive file attachments. Stored on the VM at `{workspace_root}/agents/{id}/attachments/{attachment_id}/{filename}`. Served to the browser via `AttachmentController`.

**Inter-agent messaging** — Agents write YAML envelopes to outbox. `agent-runner.ts` watches outbox dirs via `fs.watch` and routes to target inbox. Messages persisted to DB as `role: "inter_agent"`.

**Scheduled tasks** — Oban-based (`scheduled_tasks` table). Supports one-time and recurring (cron-based) automated messages to agents. `ScheduleWorker` executes jobs; `Shire.Schedules.ensure_jobs_enqueued/0` re-enqueues on app boot.

## Folder Structure

```
lib/shire/
  project_manager.ex              # Boots all project VMs on startup
  project_instance_supervisor.ex  # Per-project: VM + Coordinator + DynamicSupervisor
  projects.ex                     # Context: Project CRUD
  agents.ex                       # Context: Agent + Message CRUD
  agents/                         # Ecto schemas (agent.ex, message.ex)
  agent/
    agent_manager.ex              # Per-agent GenServer: lifecycle, runner, messaging
    coordinator.ex                # Per-project: VM bootstrap, agent CRUD, message routing
    terminal_session.ex           # Interactive TTY on the VM
  catalog.ex                      # Reads agent templates from priv/catalog/
  projects/
    project.ex                    # Ecto schema for projects
  schedules.ex                    # Context: Scheduled task CRUD
  schedules/
    scheduled_task.ex             # Ecto schema for scheduled tasks
  slug.ex                         # Slug generation
  virtual_machine.ex              # Behaviour (cmd, read, write, spawn_command, etc.)
  virtual_machine/
    setup.ex                      # Shared VM setup logic (bootstrap + runner deployment)
  virtual_machine_sprite.ex       # GenServer wrapping Sprites SDK (production)
  virtual_machine_ssh.ex          # SSH to any VPS via SSH + SFTP
  virtual_machine_ssh/
    key_cb.ex                     # SSH client key callback for key-based auth
  virtual_machine_local.ex        # Local filesystem + Erlang ports (development)
  workspace.ex                    # Workspace path resolution (delegates to VM backend)
  workspace_settings.ex           # Per-project env vars and scripts
  workers/
    schedule_worker.ex            # Oban worker for scheduled task execution

lib/shire_web/controllers/
  attachment_controller.ex          # File attachment download endpoint
  shared_drive_controller.ex        # Shared drive file operations

lib/shire_web/live/
  project_live/index.ex           # ProjectDashboard (root "/" route)
  agent_live/                     # AgentDashboard, AgentShow, agent_streaming, helpers
  project_details_live/index.ex   # ProjectDetailsPage (rename, edit PROJECT.md)
  settings_live/index.ex          # SettingsPage
  shared_drive_live/index.ex      # SharedDrive
  schedule_live/index.ex          # SchedulesPage

assets/react-components/
  AgentDashboard.tsx              # Agent list + chat panel for a project
  AgentShow.tsx                   # Single agent detail view
  AgentForm.tsx                   # Agent creation/edit form
  ProjectDashboard.tsx            # Root "/" — project list
  ProjectDetailsPage.tsx          # Project rename, edit PROJECT.md
  SettingsPage.tsx                # Project settings (env vars, scripts)
  SharedDrive.tsx                 # Shared drive file browser
  SchedulesPage.tsx               # Scheduled tasks management
  ActivityLog.tsx                 # Agent activity log
  CatalogBrowser.tsx              # Browse agent catalog templates
  WelcomePanel.tsx                # Welcome/onboarding panel
  Terminal.tsx                    # xterm.js interactive terminal
  ProjectSwitcher.tsx             # Project dropdown switcher
  AgentSidebar.tsx                # Agent list sidebar
  ChatHeader.tsx                  # Chat panel header
  ChatPanel.tsx                   # Chat message list + input
  components/AppLayout.tsx        # Shared layout wrapper
  components/Markdown.tsx         # Markdown renderer
  components/ui/                  # shadcn/ui primitives
  lib/navigate.ts                 # LiveView navigation utility
  lib/utils.ts                    # Shared utilities (cn, etc.)

priv/sprite/                      # Agent runtime, deployed to {workspace_root}/.runner/
  agent-runner.ts                 # Daemon: watches inbox, dispatches to harness, emits JSONL
  bootstrap.sh                    # VM bootstrap (creates workspace dirs)
  harness/                        # Adapter pattern: pi-harness.ts, claude-code-harness.ts

priv/catalog/                     # Agent templates (gitignored, populated by `mix catalog.sync`)
  categories.yaml                 # Category definitions
  agents/{category}/*.yaml        # Agent recipes by category
```

## Verification Commands

After any implementation change, run these checks:

```bash
# Backend
mix compile --warnings-as-errors   # Elixir compilation + warnings
mix format --check-formatted       # Elixir formatting
mix test                           # Elixir tests

# Frontend (from assets/)
cd assets && bunx tsc --noEmit     # TypeScript typecheck
cd assets && bun run lint          # ESLint
cd assets && bun run format:check  # Prettier
cd assets && bun run test          # Vitest component tests

# Agent runner (from priv/sprite/)
cd priv/sprite && bun run lint          # ESLint
cd priv/sprite && bun run format:check  # Prettier
```

Full precommit (compile + deps.unlock + format + lint + test):
```bash
mix precommit
```

## Environment

- `SHIRE_VM_TYPE` — selects VM backend: `sprites` (default, Firecracker), `ssh` (any VPS via SSH), or `local` (local filesystem for dev)
- `SPRITES_TOKEN` — required when using the Sprite backend
- `SHIRE_SSH_HOST` / `SHIRE_SSH_USER` — required when using the SSH backend
- `SHIRE_SSH_KEY` — raw PEM private key content (one of `SHIRE_SSH_KEY` or `SHIRE_SSH_PASSWORD` required for SSH)
- `SHIRE_SSH_PASSWORD` — SSH password (alternative to `SHIRE_SSH_KEY`)
- `SHIRE_SSH_PORT` — SSH port (default: `22`)
- `SHIRE_SSH_WORKSPACE_ROOT` — workspace root on the remote host (default: `/home/{user}/shire/projects`)
- `ANTHROPIC_API_KEY` — passed to agents via project `.env` file on the VM

## Guidelines

- Use `bun` for all JS package management and scripts, never `npm` or `node`
- Use `Req` for HTTP requests, never httpoison/tesla/httpc
- Use `yaml_elixir` for YAML parsing in Elixir
- Elixir schema fields use `:string` type even for text columns
- Generate migrations with `mix ecto.gen.migration`
- No `@apply` in CSS
- Use shadcn/ui components (Button, Input, Dialog, etc.) over plain HTML elements
- shadcn dialog animations: fade + zoom only, no slide classes (they conflict with translate centering)
