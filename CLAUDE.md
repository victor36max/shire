# Sprite Agents

## Tech Stack

- **Backend:** Elixir / Phoenix 1.8 / Ecto / PostgreSQL
- **Frontend:** LiveReact (React components inside Phoenix LiveView) + shadcn/ui (Radix + Tailwind v4)
- **Build:** Vite (not esbuild), Bun (not npm/node)
- **Encryption:** Cloak/CloakEcto for secrets at rest
- **CSS:** Tailwind v4 with `@theme inline` + oklch CSS variables (shadcn default)
- **Agent runtime:** Bun + multi-harness adapter pattern (Pi SDK, Claude Code CLI)

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
- One page-level React component per LiveView (e.g., `AgentPage`, `AgentShow`, `SecretList`)
- React receives `pushEvent` as a prop from LiveReact to send events back to LiveView
- Use specific event names like `create-agent`, `update-agent` instead of generic `save` (avoids dependency on `live_action`)
- Shared `AppLayout` component wraps all pages with consistent padding/max-width
- The Elixir `app` layout is a passthrough — layout is handled in React

## Folder Structure

```
lib/
  sprite_agents/
    application.ex           # OTP application
    agents.ex                # Context: Agent + Secret CRUD
    agents/
      agent.ex               # Agent schema (includes harness enum)
      secret.ex              # Secret schema (Cloak-encrypted value)
    agent/
      agent_manager.ex       # Agent deployment & management
      coordinator.ex         # Agent coordinator
    mailbox.ex               # Agent mailbox
    vault.ex                 # Cloak vault
    encrypted/binary.ex      # Custom encrypted binary type
    repo.ex
  sprite_agents_web/
    router.ex
    components/
      core_components.ex     # Core UI components (react helper, etc.)
      layouts.ex             # Passthrough app layout + flash_group
      layouts/root.html.heex
    live/
      agent_live/
        index.ex             # Renders <.react name="AgentPage" />
        show.ex              # Renders <.react name="AgentShow" />
      secret_live/
        index.ex             # Renders <.react name="SecretList" />

assets/
  js/app.js                  # LiveSocket + LiveReact hooks
  css/app.css                # Tailwind v4 + shadcn theme variables
  vite.config.js
  react-components/
    AgentPage.tsx             # Agent list page
    AgentShow.tsx             # Agent detail page
    AgentCard.tsx             # Card component for agent grid
    AgentForm.tsx             # Dialog form (controlled via open/onClose props)
    AgentList.tsx             # Agent list component
    SecretList.tsx            # Secrets page
    types.ts                 # Shared TypeScript type definitions
    index.ts                 # Barrel exports for LiveReact
    components/
      AppLayout.tsx           # Shared layout wrapper
      ui/                     # shadcn/ui components (button, card, dialog, etc.)
    lib/
      utils.ts                # cn() utility
  test/
    setup.ts                  # Vitest test setup
    AgentCard.test.tsx        # Component tests
    AgentPage.test.tsx
    AgentShow.test.tsx
    SecretList.test.tsx

priv/sprite/                  # Agent runtime (Bun/TypeScript)
  agent-runner.ts             # Main agent runner
  bootstrap.sh                # VM bootstrap script
  harness/
    types.ts                  # Harness interface definition
    index.ts                  # Harness exports
    pi-harness.ts             # Pi SDK harness adapter
    claude-code-harness.ts    # Claude Code CLI harness adapter
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
cd assets && bun run test          # Vitest component tests
```

Full precommit (compile + format + test):
```bash
mix precommit
```

**Rules:**
- Always write tests for new features and bug fixes
- Always run verification after implementing changes — don't leave broken builds
- Fix warnings and type errors before considering work done

## Guidelines

- Use `bun` for all JS package management and scripts, never `npm` or `node`
- Use `Req` for HTTP requests, never httpoison/tesla/httpc
- Elixir schema fields use `:string` type even for text columns
- Always generate migrations with `mix ecto.gen.migration`
- Don't use `@apply` in CSS
- Always use shadcn/ui components (Button, Input, Dialog, etc.) instead of plain HTML elements unless the library doesn't support the needed component
- shadcn dialog animations: use fade + zoom only, no slide classes (they conflict with translate centering)
