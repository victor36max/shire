# Shire

## Tech Stack

- **Backend:** Elixir / Phoenix 1.8 / Ecto / PostgreSQL
- **Frontend:** LiveReact (React components inside Phoenix LiveView) + shadcn/ui (Radix + Tailwind v4)
- **Build:** Vite (not esbuild), Bun (not npm/node)
- **CSS:** Tailwind v4 with `@theme inline` + oklch CSS variables (shadcn default)
- **VM:** Sprite VM (Firecracker), managed via `VirtualMachineImpl` GenServer
- **Agent runtime:** Bun + multi-harness adapter pattern (Pi SDK, Claude Code CLI)
- **Agent deployment:** Recipe-based (YAML recipes on the VM filesystem, no DB schema)
- **Inter-agent comms:** File-based inbox/outbox directories + host-side outbox polling + peer discovery via `peers.json`
- **Shared drive:** `/drive` on the VM, synced to all agents at `/workspace/shared/`

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
- One page-level React component per LiveView (e.g., `AgentDashboard`, `AgentShow`, `SettingsPage`, `SharedDrive`)
- React receives `pushEvent` as a prop from LiveReact to send events back to LiveView
- Use specific event names like `create-agent`, `update-agent` instead of generic `save` (avoids dependency on `live_action`)
- Shared `AppLayout` component wraps all pages with consistent padding/max-width
- The Elixir `app` layout is a passthrough — layout is handled in React

## Key Concepts

**Projects** — DB-backed (`projects` table, UUID PK). Each project owns one Sprite VM and a set of agents. `ProjectManager` boots all project VMs on startup.

**Supervision tree:**
- `ProjectManager` → `ProjectInstanceSupervisor` (per project, `one_for_all`) → `[VirtualMachineImpl, Coordinator, DynamicSupervisor]`
- Registries: `AgentRegistry` (agents by name), `ProjectRegistry` (project supervisors by ID)

**Recipes** — YAML files defining agents (`name`, `description`, `harness`, `scripts`). Live on the VM at `/workspace/agents/{name}/recipe.yaml` — no DB schema for recipes. Agents themselves are DB-backed with a unique constraint on `(project_id, name)`.

**Agent lifecycle:**
- `Coordinator` handles per-project agent CRUD — writes `recipe.yaml` to VM, starts `AgentManager` under `DynamicSupervisor`
- `AgentManager` bootstraps workspace dirs (inbox, outbox, scripts, documents), writes communication prompts, spawns `agent-runner.ts`

**Inter-agent messaging** — Agents write JSON envelopes to outbox. `AgentManager` polls every 2s (pauses after 15 min idle), routes to target inbox. Messages persisted to DB as `role: "inter_agent"`.

## Folder Structure

```
lib/shire/
  project_manager.ex              # Boots all project VMs on startup
  project_instance_supervisor.ex  # Per-project: VirtualMachineImpl + Coordinator + DynamicSupervisor
  projects.ex                     # Context: Project CRUD
  agents.ex                       # Context: Agent + Message CRUD
  agents/                         # Ecto schemas (agent.ex, message.ex)
  agent/
    agent_manager.ex              # Per-agent GenServer: lifecycle, runner, outbox polling
    coordinator.ex                # Per-project: VM bootstrap, agent CRUD, message routing
    terminal_session.ex           # Interactive TTY on the VM
  virtual_machine.ex              # Behaviour (cmd, read, write, spawn_command, etc.)
  virtual_machine_impl.ex         # GenServer wrapping Sprites SDK
  workspace_settings.ex           # Per-project env vars and scripts

lib/shire_web/live/
  project_live/index.ex           # ProjectDashboard (root "/" route)
  agent_live/                     # AgentDashboard, AgentShow, agent_streaming, helpers
  settings_live/index.ex          # SettingsPage
  shared_drive_live/index.ex      # SharedDrive

assets/react-components/
  *.tsx                           # One page-level component per LiveView
  components/ui/                  # shadcn/ui primitives
  components/AppLayout.tsx        # Shared layout wrapper
  lib/navigate.ts                 # LiveView navigation utility
  test/                           # Vitest component tests (one per component)

priv/sprite/                      # Agent runtime, deployed to /workspace/.runner/
  agent-runner.ts                 # Daemon: watches inbox, dispatches to harness, emits JSONL
  bootstrap.sh                    # VM bootstrap (creates /workspace dirs)
  harness/                        # Adapter pattern: pi-harness.ts, claude-code-harness.ts
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

## Guidelines

- Use `bun` for all JS package management and scripts, never `npm` or `node`
- Use `Req` for HTTP requests, never httpoison/tesla/httpc
- Use `yaml_elixir` for YAML parsing in Elixir
- Elixir schema fields use `:string` type even for text columns
- Generate migrations with `mix ecto.gen.migration`
- No `@apply` in CSS
- Use shadcn/ui components (Button, Input, Dialog, etc.) over plain HTML elements
- shadcn dialog animations: fade + zoom only, no slide classes (they conflict with translate centering)
