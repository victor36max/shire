# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shire is an AI agent orchestration platform. Users create projects, add agents (defined as YAML recipes), and work alongside them in real-time. Agents persist across sessions, communicate with each other via an inbox/outbox mailbox system, and share files through a shared drive.

## Tech Stack

- **Runtime**: Bun (never use npm/node)
- **Backend**: Hono (HTTP framework) + Drizzle ORM + SQLite
- **Frontend**: React 19 + React Router 7 + Radix UI/shadcn + Tailwind CSS 4 + TanStack Query + Zustand
- **Agent harnesses**: Claude Code SDK (`@anthropic-ai/claude-agent-sdk`), Pi Agent SDK
- **Testing**: Bun test (backend), Vitest + Testing Library (frontend)
- **Validation**: Zod (API input), TypeScript strict mode throughout

## Commands

```bash
# Development
bun run dev                # Backend server on :3000
bun run dev:frontend       # Vite dev server on :5173

# Testing
bun test                                    # Backend tests
bun run test:frontend                       # Frontend tests (Vitest)
bun run test:all                            # Both suites
bun test src/path/to/file.test.ts           # Single backend test file
bunx vitest run src/frontend/test/File.test.tsx --config src/frontend/vite.config.ts  # Single frontend test

# Quality
bun run lint               # ESLint
bun run lint:fix           # ESLint autofix
bun run format             # Prettier write
bun run format:check       # Prettier check
bun run typecheck          # tsc --noEmit

# Database
bun run db:generate        # Generate Drizzle migrations from schema
bun run db:migrate         # Apply migrations
```

## Architecture

### Runtime Layer (`src/runtime/`)

Three-tier orchestration hierarchy:
1. **ProjectManager** — boots all projects, creates one Coordinator per project
2. **Coordinator** — per-project: manages AgentManagers, routes inter-agent messages, watches recipe.yaml changes, maintains peers.yaml
3. **AgentManager** — per-agent: manages harness process lifecycle, message queue (inbox/outbox), streaming, auto-restart (up to 3 times)

Harnesses (`src/runtime/harness/`) are adapters for different AI backends (Claude Code, Pi). They implement a common interface: `start`, `sendMessage`, `interrupt`, `clearSession`, `isProcessing`.

### Data Layer (`src/db/schema.ts`, `src/services/`)

Four tables: `projects`, `agents`, `messages`, `scheduled_tasks`. Services are pure functions that take a Drizzle DB instance — backend tests use in-memory SQLite with `useTestDb()`.

### API Layer (`src/routes/`)

Hono routes under `/api`. Real-time updates via WebSocket with topic-based pub/sub through an EventEmitter event bus (`src/events.ts`).

### Frontend (`src/frontend/`)

React SPA with file-based page structure. Uses shadcn/ui components in `src/frontend/components/ui/`. Vite config at `src/frontend/vite.config.ts`, separate tsconfig at `src/frontend/tsconfig.json`.

### Workspace on Disk

```
~/.shire/
├── shire.db
└── projects/{projectId}/
    ├── agents/{agentId}/
    │   ├── recipe.yaml      # Agent definition
    │   ├── inbox/           # Incoming inter-agent messages
    │   └── outbox/          # Outgoing inter-agent messages
    ├── shared/              # Cross-agent shared drive
    └── peers.yaml           # Agent discovery registry
```

## Code Conventions

- **No `eslint-disable`** — fix the underlying issue
- **`@typescript-eslint/no-explicit-any: "error"`** — no `any` types allowed
- **Unused vars**: prefix with `_` (enforced by ESLint)
- **Formatting**: Prettier with double quotes, semicolons, trailing commas, 100 char width
- **Agent/project names**: must be valid slugs (2-63 chars, lowercase, letters/numbers/hyphens)
- **Backend tsconfig** excludes `src/frontend/` — they have separate TypeScript configs
