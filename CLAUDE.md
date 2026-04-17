# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shire is an AI agent orchestration platform. Users create projects, add agents (configured through the dashboard and stored in the database), and work alongside them in real-time. Agents persist across sessions, communicate with each other via an inbox/outbox mailbox system, and share files through a shared drive.

## Tech Stack

- **Runtime**: Bun (never use npm/node)
- **Backend**: Hono (HTTP framework) + Drizzle ORM + SQLite
- **Frontend**: React 19 + React Router 7 + Radix UI/shadcn + Tailwind CSS 4 + TanStack Query
- **Bundler**: Bun fullstack (dev server with HMR) + bun-plugin-tailwind
- **Agent harnesses**: Claude Code SDK (`@anthropic-ai/claude-agent-sdk`), OpenCode SDK (`@opencode-ai/sdk`), Pi Agent SDK, Codex SDK (`@openai/codex-sdk`)
- **Testing**: Bun test + Testing Library + happy-dom + MSW (unified for backend and frontend)
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

Harnesses (`src/runtime/harness/`) are adapters for different AI backends (Claude Code, OpenCode, Pi, Codex). They implement a common interface: `start`, `sendMessage`, `interrupt`, `clearSession`, `isProcessing`.

### Data Layer (`src/db/schema.ts`, `src/services/`)

Six tables: `projects`, `agents`, `messages`, `scheduled_tasks`, `alert_channels`, `refresh_tokens`. Services are pure functions that take a Drizzle DB instance — backend tests use in-memory SQLite with `useTestDb()`.

### API Layer (`src/routes/`)

Hono routes under `/api`. Real-time updates via WebSocket with topic-based pub/sub through an EventEmitter event bus (`src/events.ts`).

### Authentication (`src/routes/auth.ts`, `src/middleware/auth.ts`, `src/lib/auth-config.ts`)

Optional username/password authentication, enabled by setting `SHIRE_USERNAME` and `SHIRE_PASSWORD` environment variables. When disabled, all routes are open.

- **JWT-based**: access tokens (15-minute TTL) via `Authorization: Bearer` header, refresh tokens (30-day TTL) via httpOnly cookie
- **Auth middleware** (`src/middleware/auth.ts`) — validates JWT on all protected API routes when auth is enabled
- **Auth routes** (`src/routes/auth.ts`) — `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- **Config route** (`src/server.ts`) — `GET /api/config` returns `{ authEnabled }`, publicly accessible
- **WebSocket auth** — JWT token passed via `?token=` query string, validated before upgrade (only when auth is enabled)
- **Rate limiting** — 5 login attempts per 60 seconds per IP
- **JWT secret** — auto-generated 32-byte secret stored at `~/.shire/.jwt-secret` (mode 0o600)
- **Frontend** — Zustand auth store (`src/frontend/stores/auth.ts`), login page (`src/frontend/pages/Login.tsx`), `RequireAuth` route guard, proactive token refresh

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
├── .jwt-secret            # Auto-generated JWT signing key (when auth enabled)
└── projects/{projectId}/
    ├── agents/{agentId}/
    │   ├── inbox/           # Incoming inter-agent messages
    │   ├── outbox/          # Outgoing inter-agent messages
    │   ├── attachments/     # File attachments
    │   ├── .claude/skills/  # Skills (Claude Code harness)
    │   └── .agents/skills/  # Skills (OpenCode/Pi harnesses)
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
- **Test colocation** — tests live next to source files as `.test.ts`/`.test.tsx`

## Database Migrations

- **Foreign keys are disabled before `migrate()` runs** (`src/index.ts`, `src/test/setup.ts`) — SQLite ignores `PRAGMA foreign_keys=OFF` inside transactions, and Drizzle wraps migrations in a transaction, so the guard must be set at the connection level before `migrate()` is called. This prevents `DROP TABLE` from triggering `ON DELETE CASCADE`.
- **Strip `PRAGMA foreign_keys` lines from generated migrations** — the outer guard handles it. In-migration PRAGMAs are no-ops inside Drizzle's transaction and would conflict if Drizzle ever changes its transaction handling.
- Always review generated migration SQL before committing — look for `DROP TABLE` statements and verify data is copied via `INSERT INTO ... SELECT`.
- `bun run db:generate` is safe for any schema change (including column defaults) as long as the FK guard is in place.
