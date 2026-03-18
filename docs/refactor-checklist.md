# Single-VM Refactor Checklist

Design spec: `docs/superpowers/specs/2026-03-18-single-vm-architecture-design.md`

## Phase 1: Foundation (DB + dead code removal) ✅
- [x] Create migration: drop `agents`, `secrets`, `messages` tables; recreate `messages` with `agent_name`
- [x] Run migration
- [x] Remove `lib/shire/agents/agent.ex`
- [x] Remove `lib/shire/agents/secret.ex`
- [x] Remove `lib/shire/vault.ex` + `lib/shire/encrypted/`
- [x] Remove `lib/shire/mailbox.ex`
- [x] Remove `lib/shire/agent/drive_sync.ex`
- [x] Keep `lib/shire/agent/sprite_helpers.ex` (still needed by Coordinator for filesystem workaround)
- [x] Update `lib/shire/agents/message.ex` — `agent_name` string field, no association
- [x] Update `lib/shire/agents.ex` — remove agent/secret CRUD, keep message CRUD with `agent_name`
- [x] Remove DriveSync from `lib/shire/application.ex` supervision tree
- [x] Remove Cloak config from `config/`
- [x] `mix compile --warnings-as-errors` passes

## Phase 2: Core (Coordinator + AgentManager) ✅
- [x] Refactor `coordinator.ex` — single VM lifecycle, scan `/workspace/agents/`, remove peer broadcasting
- [x] Refactor `agent_manager.ex` — receive shared sprite, create agent workspace dir, deploy skills, write config
- [x] Update `bootstrap.sh` — base structure only
- [x] Update `application.ex` — AgentRegistry keyed by name (string keys via registry)
- [x] Test: app starts, single VM bootstraps, can create agent workspace dir
- [x] `mix compile --warnings-as-errors` passes

## Phase 3: Agent Runner ✅
- [x] Parameterize paths via `--agent-dir` CLI arg
- [x] Remove `processOutbox`, outbox watcher
- [x] Remove shared drive watcher + echo-prevention
- [x] Remove recipe execution (`runRecipes`, marker functions)
- [x] Add `sendToAgent()` for direct inbox writes
- [x] Add `spawn_agent` event emission (handled in AgentManager stdout handler)
- [x] Change harness `cwd` to agent dir
- [x] Update SIGTERM handler
- [x] `cd priv/sprite && bun run lint && bun run format:check && bun test` passes

## Phase 4: UI (LiveView + React) ✅
- [x] Update router — agent routes use `:name`
- [x] Refactor `agent_live/index.ex` — agents from Coordinator
- [x] Refactor `agent_live/show.ex` — agent by name from Coordinator
- [x] Update `AgentDashboard.tsx` — name-based agent identity
- [x] Update `AgentShow.tsx` — name-based, kill→delete
- [x] Update `AgentForm.tsx` — create agent via Coordinator (no DB), keep raw YAML toggle
- [x] Remove `SecretList.tsx`
- [x] Update `types.ts` — agent type without DB id
- [x] `cd assets && bun run tsc --noEmit && bun run lint && bun run test` passes

## Phase 5: Settings ✅
- [x] Rewrite settings LiveView — env read/write `/workspace/.env` via Coordinator API
- [x] Rewrite `SettingsPage.tsx` — tabs for Environment, Scripts, Activity Log
- [x] Add global scripts section — list/create/edit/delete `/workspace/.scripts/` files
- [x] Add "Run" button per script — executes via `Coordinator.run_script`
- [x] Activity log uses `agent_name` directly, no preload
- [x] All tests pass

## Phase 6: Terminal ✅
- [x] Refactor `terminal_session.ex` — global session, `:global_terminal` registry key
- [x] Update `show.ex` — global terminal (not per-agent)
- [x] Update PubSub topic to `"terminal:global"`
- [x] Update terminal session tests

## Phase 7: Cleanup + Full Verification ✅
- [x] Update remaining tests for new architecture
- [x] `mix compile --warnings-as-errors` passes
- [x] `mix format --check-formatted` passes
- [x] `mix test` — 57 tests, 0 failures
- [x] `cd assets && bun run tsc --noEmit` passes
- [x] `cd assets && bun run lint` passes
- [x] `cd assets && bun run format:check` passes
- [x] `cd assets && bun run test` — 84 tests, 0 failures (9 files)
- [x] `cd priv/sprite && bun test` — 41 tests, 0 failures
