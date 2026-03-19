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

**Projects:** First-class DB-backed entities (`projects` table, UUID primary key). Each project owns a dedicated Sprite VM and a set of agents. The `ProjectManager` GenServer boots all project VMs on application startup. Projects are created/deleted from the `ProjectDashboard` UI at `/`.

**Sprite VM:** Each project gets its own Sprite VM (Firecracker). The VM name is derived from the project UUID. On boot, the `Coordinator` (started per-project) runs `bootstrap.sh`, deploys the agent runner, then scans `/workspace/agents/` for existing recipes. Each agent gets its own directory under `/workspace/agents/{name}/`.

**Supervision tree:** `ProjectManager` → `ProjectInstanceSupervisor` (one per project, `one_for_all` strategy) → `[VirtualMachineImpl, Coordinator, DynamicSupervisor]`. Two registries: `AgentRegistry` (agents by name) and `ProjectRegistry` (project supervisors by ID).

**Recipe system:** Agents are defined by YAML recipes containing `name`, `description`, `harness`, and `scripts` (array of `{name, run}` steps). Recipes live on the VM filesystem as `/workspace/agents/{name}/recipe.yaml` — no database schema for recipes. Agents themselves are DB-backed (`agents` table) with a `belongs_to :project` relationship and a unique constraint on `(project_id, name)`. The agent runner executes setup scripts idempotently.

**Agent lifecycle:** The `Coordinator` manages per-project agent CRUD. Creating an agent writes `recipe.yaml` to the project's VM and starts an `AgentManager` under the project's `DynamicSupervisor`. Agents are registered by name in `AgentRegistry`. The `AgentManager` bootstraps the agent workspace (inbox, outbox, scripts, documents dirs), writes communication prompts, and spawns the `agent-runner.ts` daemon.

**Inter-agent messaging:** File-based. Agents write JSON envelopes to their outbox directory. The `AgentManager` polls outbox every 2s (idle-aware — pauses after 15 min inactivity), reads messages, and routes them to the target agent's inbox via `AgentManager.send_message/3`. Messages are persisted to the DB with role `"inter_agent"`.

**Shared drive:** `/drive` on the VM, synced to each agent at `/workspace/shared/`.

**Terminal sessions:** Interactive TTY session (`bash -i`) on the VM, bridged to LiveView via PubSub and rendered with xterm.js in React.

**Slug validation:** Project and agent names must be valid slugs (lowercase alphanumeric + hyphens, 2-50 chars). Enforced by the `Slug` module.

## Folder Structure

```
lib/
  shire/
    application.ex           # OTP supervision tree (ProjectManager, ProjectRegistry, ProjectSupervisor, AgentRegistry)
    project_manager.ex       # GenServer: boots all project VMs on startup, creates/deletes projects
    project_instance_supervisor.ex  # Per-project supervisor (one_for_all): VirtualMachineImpl + Coordinator + DynamicSupervisor
    projects.ex              # Context: Project CRUD
    projects/
      project.ex             # Project Ecto schema (UUID PK, unique name)
    agents.ex                # Context: Agent + Message CRUD
    agents/
      agent.ex               # Agent Ecto schema (belongs_to project, unique name per project)
      message.ex             # Message schema (agent chat + inter-agent communication)
    agent/
      agent_manager.ex       # Per-agent GenServer: lifecycle, runner process, outbox polling, event persistence
      coordinator.ex         # Per-project orchestrator: VM bootstrap, agent CRUD, message routing, env/scripts API
      terminal_session.ex    # Interactive TTY session on the VM
    slug.ex                  # Slug validation for project/agent names
    workspace_settings.ex    # Per-project environment variables and scripts management
    virtual_machine.ex       # Behaviour defining VM operations (cmd, read, write, spawn_command, etc.)
    virtual_machine_impl.ex  # GenServer wrapping Sprites SDK with error handling and timeouts
    mailer.ex
    release.ex
    repo.ex
  shire_web/
    router.ex
    endpoint.ex
    gettext.ex
    telemetry.ex
    components/
      core_components.ex     # Core UI components (react helper, etc.)
      layouts.ex             # Passthrough app layout + flash_group
      layouts/root.html.heex
    controllers/
      page_controller.ex
      page_html.ex
      page_html/home.html.heex
      error_html.ex
      error_json.ex
      shared_drive_controller.ex  # File download/stream endpoint
    live/
      project_live/
        index.ex             # Renders <.react name="ProjectDashboard" /> (root "/" route)
      agent_live/
        index.ex             # Renders <.react name="AgentDashboard" /> (project-scoped)
        show.ex              # Renders <.react name="AgentShow" />
        agent_streaming.ex   # Agent event processing (JSONL parsing, PubSub bridge)
        helpers.ex           # Message serialization helpers
      settings_live/
        index.ex             # Renders <.react name="SettingsPage" /> (project-scoped)
      shared_drive_live/
        index.ex             # Renders <.react name="SharedDrive" /> (project-scoped)

assets/
  js/app.js                  # LiveSocket + LiveReact hooks
  css/app.css                # Tailwind v4 + shadcn theme variables
  vite.config.js
  react-components/
    ProjectDashboard.tsx      # Projects list page with create/delete dialogs
    ProjectSwitcher.tsx       # Project selector dropdown for navigation
    AgentDashboard.tsx        # Main dashboard with agent sidebar + chat/welcome panel
    AgentSidebar.tsx          # Agent list sidebar for dashboard
    AgentShow.tsx             # Agent detail page with edit form
    AgentForm.tsx             # Dialog form (controlled via open/onClose props)
    ChatHeader.tsx            # Chat panel header with agent info + status badge
    ChatPanel.tsx             # Chat/message panel for agent interaction
    WelcomePanel.tsx          # Welcome/empty state panel
    ActivityLog.tsx           # Inter-agent message timeline
    SettingsPage.tsx          # Settings page (env, scripts, terminal, activity)
    SharedDrive.tsx           # Shared drive file browser (upload/delete/navigate)
    Terminal.tsx              # xterm.js interactive terminal via WebSocket bridge
    types.ts                 # Shared TypeScript type definitions
    index.ts                 # Barrel exports for LiveReact
    components/
      AppLayout.tsx           # Shared layout wrapper
      Markdown.tsx            # React Markdown renderer (GitHub-flavored)
      ui/                     # shadcn/ui components (button, card, dialog, alert-dialog, dropdown-menu, select, tabs, textarea, badge, table, input, label, etc.)
    lib/
      utils.ts                # cn() utility
      navigate.ts             # LiveView navigation utility (smooth navigation without full page reload)
  test/
    setup.ts                  # Vitest test setup
    ProjectDashboard.test.tsx
    ProjectSwitcher.test.tsx
    AgentDashboard.test.tsx
    AgentForm.test.tsx
    AgentShow.test.tsx
    AgentSidebar.test.tsx
    ActivityLog.test.tsx
    ChatPanel.test.tsx
    SettingsPage.test.tsx
    SharedDrive.test.tsx
    Terminal.test.tsx
    navigate.test.ts

priv/sprite/                  # Agent runtime (Bun/TypeScript), deployed to /workspace/.runner/
  agent-runner.ts             # Main daemon: watches inbox, dispatches to harness, emits JSONL events
  bootstrap.sh                # VM bootstrap script (creates /workspace dirs)
  harness/
    types.ts                  # Harness interface definition
    index.ts                  # Harness factory (creates harness by type)
    pi-harness.ts             # Pi SDK harness adapter
    claude-code-harness.ts    # Claude Code CLI harness adapter
  agent-runner.test.ts        # Agent runner tests
  harness/
    pi-harness.test.ts        # Pi harness tests
    claude-code-harness.test.ts # Claude Code harness tests
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

**Rules (CRITICAL — never skip these):**
- **Always write tests for new features and bug fixes** — no exceptions, every new function/behavior must have corresponding test coverage
- **Always run verification after implementing changes** — don't leave broken builds
- **Fix ALL test failures before claiming work is done** — including pre-existing failures unrelated to your change. If tests are failing, fix them.
- Fix warnings and type errors before considering work done
- **Always fix any bug, lint, or type check issue you see along the way**, regardless of whether it's related to your current change — never dismiss failures as "pre-existing" or "unrelated"

## Guidelines

- Use `bun` for all JS package management and scripts, never `npm` or `node`
- Use `Req` for HTTP requests, never httpoison/tesla/httpc
- Use `yaml_elixir` for YAML parsing in Elixir
- Elixir schema fields use `:string` type even for text columns
- Always generate migrations with `mix ecto.gen.migration`
- Don't use `@apply` in CSS
- Always use shadcn/ui components (Button, Input, Dialog, etc.) instead of plain HTML elements unless the library doesn't support the needed component
- shadcn dialog animations: use fade + zoom only, no slide classes (they conflict with translate centering)
- **Never use `eslint-disable` comments casually** — disabling lint rules is an anti-pattern. Fix the underlying issue (use proper types, runtime checks, etc.) instead. Only use `eslint-disable` when there is genuinely no other option.
