# Shire

## Tech Stack

- **Backend:** Elixir / Phoenix 1.8 / Ecto / PostgreSQL
- **Frontend:** LiveReact (React components inside Phoenix LiveView) + shadcn/ui (Radix + Tailwind v4)
- **Build:** Vite (not esbuild), Bun (not npm/node)
- **Encryption:** Cloak/CloakEcto for secrets at rest
- **CSS:** Tailwind v4 with `@theme inline` + oklch CSS variables (shadcn default)
- **Agent runtime:** Bun + multi-harness adapter pattern (Pi SDK, Claude Code CLI)
- **Agent deployment:** Recipe-based (YAML recipes defining setup scripts per agent)
- **Inter-agent comms:** Mailbox system with inbox/outbox directories + peer discovery via `peers.json`
- **Shared drive:** Dedicated Sprite VM for shared files, synced to all agents

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
- One page-level React component per LiveView (e.g., `AgentDashboard`, `AgentShow`, `SecretList`, `SettingsPage`, `SharedDrive`)
- React receives `pushEvent` as a prop from LiveReact to send events back to LiveView
- Use specific event names like `create-agent`, `update-agent` instead of generic `save` (avoids dependency on `live_action`)
- Shared `AppLayout` component wraps all pages with consistent padding/max-width
- The Elixir `app` layout is a passthrough — layout is handled in React

## Key Concepts

**Recipe system:** Agents are defined by YAML recipes containing `name`, `description`, and `scripts` (array of `{name, run}` steps). Recipes are deployed to `/workspace/recipe.json` in the Sprite VM and executed idempotently by `recipe-runner.ts` with marker-file tracking.

**Inter-agent messaging:** The Coordinator routes messages between agents. Each agent has a mailbox with inbox/outbox directories on its Sprite VM. Peers are discovered via `peers.json`. Messages are delivered as files to `/workspace/mailbox/inbox/`.

**Shared drive:** A dedicated Sprite VM managed by `DriveSync` provides shared file storage at `/drive`. All agents sync to `/workspace/shared/`. File changes are broadcast via PubSub.

**Terminal sessions:** Interactive TTY sessions (`bash -i`) on Sprite VMs, bridged to LiveView via PubSub and rendered with xterm.js in React.

## Folder Structure

```
lib/
  shire/
    application.ex           # OTP application (supervises DriveSync, Coordinator, DynamicSupervisor)
    agents.ex                # Context: Agent + Secret + Message CRUD
    agents/
      agent.ex               # Agent schema (recipe-based: recipe, is_base)
      secret.ex              # Secret schema (Cloak-encrypted value)
      message.ex             # Message schema (inter-agent communication)
    agent/
      agent_manager.ex       # Agent deployment, recipe execution, lifecycle management
      coordinator.ex         # Agent lifecycle coordination, inter-agent message routing
      drive_sync.ex          # Shared drive Sprite VM management + file sync
      terminal_session.ex    # Interactive TTY sessions on Sprite VMs
      sprite_helpers.ex      # Shared helpers for Sprites SDK filesystem operations
    mailbox.ex               # Mailbox message envelope encoding/decoding, inbox writing
    vault.ex                 # Cloak vault
    encrypted/binary.ex      # Custom encrypted binary type
    mailer.ex
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
      agent_live/
        index.ex             # Renders <.react name="AgentDashboard" />
        show.ex              # Renders <.react name="AgentShow" />
        agent_streaming.ex   # Agent streaming support (SSE/PubSub bridge)
        helpers.ex           # Shared LiveView helper functions
      secret_live/
        index.ex             # Renders <.react name="SecretList" />
      settings_live/
        index.ex             # Renders <.react name="SettingsPage" />
      shared_drive_live/
        index.ex             # Renders <.react name="SharedDrive" />

assets/
  js/app.js                  # LiveSocket + LiveReact hooks
  css/app.css                # Tailwind v4 + shadcn theme variables
  vite.config.js
  react-components/
    AgentDashboard.tsx        # Main dashboard with agent sidebar + chat/welcome panel
    AgentSidebar.tsx          # Agent list sidebar for dashboard
    AgentShow.tsx             # Agent detail page
    AgentForm.tsx             # Dialog form (controlled via open/onClose props)
    ChatHeader.tsx            # Chat panel header with agent info
    ChatPanel.tsx             # Chat/message panel for agent interaction
    WelcomePanel.tsx          # Welcome/empty state panel
    ActivityLog.tsx           # Activity log display
    SecretList.tsx            # Secrets page
    SettingsPage.tsx          # Settings page
    SharedDrive.tsx           # Shared drive file browser (upload/delete/navigate)
    Terminal.tsx              # xterm.js interactive terminal via WebSocket bridge
    types.ts                 # Shared TypeScript type definitions
    index.ts                 # Barrel exports for LiveReact
    components/
      AppLayout.tsx           # Shared layout wrapper
      Markdown.tsx            # React Markdown renderer (GitHub-flavored)
      ui/                     # shadcn/ui components (button, card, dialog, alert-dialog, dropdown-menu, select, tabs, textarea, badge, table, etc.)
    lib/
      utils.ts                # cn() utility
  test/
    setup.ts                  # Vitest test setup
    AgentDashboard.test.tsx
    AgentForm.test.tsx
    AgentShow.test.tsx
    AgentSidebar.test.tsx
    ActivityLog.test.tsx
    ChatPanel.test.tsx
    SecretList.test.tsx
    SettingsPage.test.tsx
    SharedDrive.test.tsx
    Terminal.test.tsx

priv/sprite/                  # Agent runtime (Bun/TypeScript)
  agent-runner.ts             # Main agent runner (multi-harness)
  recipe-runner.ts            # Idempotent recipe script runner with marker-file tracking
  bootstrap.sh                # VM bootstrap script
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
