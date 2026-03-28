# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shire is an AI agent orchestration platform. Users create projects, add agents (configured through the dashboard and stored in the database), and work alongside them in real-time. Agents persist across sessions, communicate with each other via an inbox/outbox mailbox system, and share files through a shared drive.

## Tech Stack

- **Runtime**: Bun (never use npm/node)
- **Backend**: Hono (HTTP framework) + Drizzle ORM + SQLite
- **Frontend**: React 19 + React Router 7 + Radix UI/shadcn + Tailwind CSS 4 + TanStack Query
- **Bundler**: Bun fullstack (dev server with HMR) + bun-plugin-tailwind
- **Agent harnesses**: Claude Code SDK (`@anthropic-ai/claude-agent-sdk`), Pi Agent SDK
- **Testing**: Bun test + Testing Library + happy-dom (unified for backend and frontend)
- **Validation**: Zod (API input), TypeScript strict mode throughout

## Commands

```bash
# Development
bun run dev                # Server on :8080 with HMR

# Testing
bun test                   # All tests (backend + frontend)

# Quality
bun run lint               # ESLint
bun run lint:fix           # ESLint autofix
bun run format             # Prettier write
bun run format:check       # Prettier check
bun run typecheck          # tsc --noEmit

# Database
bun run db:generate        # Generate Drizzle migrations from schema
bun run db:migrate         # Apply migrations
bun run db:studio          # Open Drizzle Studio

# Build
bun run build:local        # Build standalone binary for current platform
bun run build:all          # Build standalone binaries for all platforms

# Catalog
bun run catalog:sync       # Sync agent catalog from community repo
```

## Architecture

### Runtime Layer (`src/runtime/`)

Three-tier orchestration hierarchy:
1. **ProjectManager** — boots all projects, creates one Coordinator per project
2. **Coordinator** — per-project: manages AgentManagers, routes inter-agent messages, maintains peers.yaml
3. **AgentManager** — per-agent: manages harness process lifecycle, message queue (inbox/outbox), streaming, auto-restart (up to 3 times)

Harnesses (`src/runtime/harness/`) are adapters for different AI backends (Claude Code, Pi). They implement a common interface: `start`, `sendMessage`, `interrupt`, `clearSession`, `isProcessing`.

### Data Layer (`src/db/schema.ts`, `src/services/`)

Four tables: `projects`, `agents`, `messages`, `scheduled_tasks`. Services are pure functions that take a Drizzle DB instance — backend tests use in-memory SQLite with `useTestDb()`.

### API Layer (`src/routes/`)

Hono routes under `/api`. Real-time updates via WebSocket with topic-based pub/sub through an EventEmitter event bus (`src/events.ts`).

### Frontend (`src/frontend/`)

React SPA bundled by Bun's fullstack dev server in development (HMR, automatic CSS/JS processing). In production, pre-built via `Bun.build()` with `bun-plugin-tailwind`. Uses shadcn/ui components in `src/frontend/components/ui/`.

### CLI (`src/cli.ts`)

Entry point for the `shire` command. Supports `start`, `stop`, `status` subcommands with `--port` and `--daemon` flags. Daemon mode uses PID files at `~/.shire/`.

### npm Packaging (`npm/`)

Platform-specific packages with standalone binaries (same pattern as esbuild/turbo). Built via `scripts/build-binaries.ts`. Released via `.github/workflows/release.yml`.

### Workspace on Disk

```
~/.shire/
├── shire.db
└── projects/{projectId}/
    ├── agents/{agentId}/
    │   ├── inbox/           # Incoming inter-agent messages
    │   ├── outbox/          # Outgoing inter-agent messages
    │   └── attachments/     # File attachments
    ├── shared/              # Cross-agent shared drive
    ├── peers.yaml           # Agent discovery registry
    └── PROJECT.md           # Project documentation
```

## Code Conventions

- **No `eslint-disable`** — fix the underlying issue
- **`@typescript-eslint/no-explicit-any: "error"`** — no `any` types allowed
- **Unused vars**: prefix with `_` (enforced by ESLint)
- **Formatting**: Prettier with double quotes, semicolons, trailing commas, 100 char width
- **Agent/project names**: must be valid slugs (2-63 chars, lowercase, letters/numbers/hyphens)
- **Single tsconfig** at project root — covers both backend and frontend
