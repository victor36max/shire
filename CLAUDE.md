# Shire

## Tech Stack

- **Backend:** Elixir / Phoenix 1.8 / Ecto / PostgreSQL
- **Frontend:** LiveReact (React components inside Phoenix LiveView) + shadcn/ui (Radix + Tailwind v4)
- **Build:** Vite (not esbuild), Bun (not npm/node)
- **CSS:** Tailwind v4 with `@theme inline` + oklch CSS variables (shadcn default)
- **VM:** Pluggable VM backend via `VirtualMachine` behaviour — `VirtualMachineSprite` (Firecracker) for production, `VirtualMachineLocal` (local filesystem + Erlang ports) for development. Selected via `SHIRE_VM_TYPE` env var.
- **Agent runtime:** Bun + multi-harness adapter pattern (Pi SDK, Claude Code CLI)
- **Agent deployment:** Recipe-based (YAML recipes on the VM filesystem, no DB schema)
- **Agent catalog:** Static YAML agent templates in `priv/catalog/agents/`, read on demand by `Shire.Catalog`
- **Scheduled tasks:** Oban-based job processing for recurring/one-time automated agent messaging
- **Inter-agent comms:** File-based inbox/outbox directories + host-side outbox polling + peer discovery via `peers.yaml`
- **Shared drive:** `/drive` on the VM (Sprite) or local filesystem (Local), synced to all agents at `{workspace_root}/shared/`

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

**Projects** — DB-backed (`projects` table, UUID PK). Each project owns one VM (Sprite or Local) and a set of agents. `ProjectManager` boots all project VMs on startup.

**Supervision tree:**
- `ProjectManager` → `ProjectInstanceSupervisor` (per project, `one_for_all`) → `[VM module, Coordinator, DynamicSupervisor]`
- VM module is selected at runtime via config (`VirtualMachineSprite` or `VirtualMachineLocal`)
- Registries: `AgentRegistry` (agents by name), `ProjectRegistry` (project supervisors by ID)

**VM backends:**
- `VirtualMachineSprite` — Production backend using Fly.io Sprites (Firecracker VMs). Workspace at `/workspace`.
- `VirtualMachineLocal` — Development backend using local filesystem (`~/.shire/projects/{project_id}/`) + Erlang ports for process execution.
- Both implement the `Shire.VirtualMachine` behaviour. `Shire.Workspace` delegates path resolution to the configured backend.

**Recipes** — YAML files defining agents (`name`, `description`, `harness`, `scripts`). Live on the VM at `{workspace_root}/agents/{name}/recipe.yaml` — no DB schema for recipes. Agents themselves are DB-backed with a unique constraint on `(project_id, name)`.

**Catalog** — YAML agent templates in `priv/catalog/agents/` organized by category. Populated by `mix catalog.sync` (gitignored, not checked in). `Shire.Catalog` reads them on demand — no GenServer, no DB schema. Categories defined in `priv/catalog/categories.yaml`.

**Agent lifecycle:**
- `Coordinator` handles per-project agent CRUD — writes `recipe.yaml` to VM, starts `AgentManager` under `DynamicSupervisor`
- `AgentManager` bootstraps workspace dirs (inbox, outbox, scripts, documents), writes communication prompts, spawns `agent-runner.ts`

**Inter-agent messaging** — Agents write JSON envelopes to outbox. `AgentManager` polls every 2s (pauses after 15 min idle), routes to target inbox. Messages persisted to DB as `role: "inter_agent"`.

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
    agent_manager.ex              # Per-agent GenServer: lifecycle, runner, outbox polling
    coordinator.ex                # Per-project: VM bootstrap, agent CRUD, message routing
    terminal_session.ex           # Interactive TTY on the VM
  catalog.ex                      # Reads agent templates from priv/catalog/
  schedules.ex                    # Context: Scheduled task CRUD
  schedules/
    scheduled_task.ex             # Ecto schema for scheduled tasks
  virtual_machine.ex              # Behaviour (cmd, read, write, spawn_command, etc.)
  virtual_machine_sprite.ex       # GenServer wrapping Sprites SDK (production)
  virtual_machine_local.ex        # Local filesystem + Erlang ports (development)
  workspace.ex                    # Workspace path resolution (delegates to VM backend)
  workspace_settings.ex           # Per-project env vars and scripts
  workers/
    schedule_worker.ex            # Oban worker for scheduled task execution

lib/shire_web/live/
  project_live/index.ex           # ProjectDashboard (root "/" route)
  agent_live/                     # AgentDashboard, AgentShow, agent_streaming, helpers
  project_details_live/index.ex   # ProjectDetailsPage (rename, edit PROJECT.md)
  settings_live/index.ex          # SettingsPage
  shared_drive_live/index.ex      # SharedDrive
  schedule_live/index.ex          # SchedulesPage

assets/react-components/
  *.tsx                           # One page-level component per LiveView + shared components
  components/ui/                  # shadcn/ui primitives
  components/AppLayout.tsx        # Shared layout wrapper
  lib/navigate.ts                 # LiveView navigation utility
  test/                           # Vitest component tests (one per component)

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
cd assets && bun run tsc --noEmit  # TypeScript typecheck
cd assets && bun run lint          # ESLint
cd assets && bun run format:check  # Prettier
cd assets && bun run test          # Vitest component tests

# Agent runner (from priv/sprite/)
cd priv/sprite && bun run lint          # ESLint
cd priv/sprite && bun run format:check  # Prettier
```

Full precommit (compile + format + test):
```bash
mix precommit
```

## Environment

- `SHIRE_VM_TYPE` — selects VM backend: `sprites` (default, Firecracker) or `local` (local filesystem for dev)
- `SPRITES_TOKEN` — required when using the Sprite backend
- `ANTHROPIC_API_KEY` — passed to agents using the Pi SDK harness

## Guidelines

- Use `bun` for all JS package management and scripts, never `npm` or `node`
- Use `Req` for HTTP requests, never httpoison/tesla/httpc
- Use `yaml_elixir` for YAML parsing in Elixir
- Elixir schema fields use `:string` type even for text columns
- Generate migrations with `mix ecto.gen.migration`
- No `@apply` in CSS
- Use shadcn/ui components (Button, Input, Dialog, etc.) over plain HTML elements
- shadcn dialog animations: fade + zoom only, no slide classes (they conflict with translate centering)
