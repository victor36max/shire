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
- [x] Remove `lib/shire/agent/sprite_helpers.ex`
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

## Phase 4: UI (LiveView + React)
- [ ] Update router — remove secret/shared-drive routes, agent routes use `:name`
- [ ] Refactor `agent_live/index.ex` — agents from Coordinator
- [ ] Refactor `agent_live/show.ex` — agent by name from Coordinator
- [ ] Update `AgentDashboard.tsx` — name-based agent identity
- [ ] Update `AgentShow.tsx` — name-based
- [ ] Update `AgentForm.tsx` — create agent via Coordinator (no DB), remove base recipe dropdown
- [ ] Remove `SecretList.tsx`, `SharedDrive.tsx`, `SecretLive`, `SharedDriveLive`, `SharedDriveController`
- [ ] Update `types.ts` — agent type without DB id
- [ ] `cd assets && bun run tsc --noEmit && bun run lint && bun run test` passes

## Phase 5: Settings
- [ ] Rewrite settings LiveView — secrets read/write `/workspace/.env` via Sprites API
- [ ] Rewrite `SettingsPage.tsx` — parse/display/edit `.env` format
- [ ] Add global scripts section — list/create/edit/delete `/workspace/.scripts/` files
- [ ] Add "Run" button per script — executes via `Sprites.spawn`
- [ ] Rewrite activity log — use `agent_name` directly, no preload
- [ ] Test: edit secrets in UI, verify `.env` updated on VM

## Phase 6: Terminal
- [ ] Refactor `terminal_session.ex` — global session, `:global_terminal` registry key
- [ ] Update UI — terminal accessible from global location
- [ ] Update PubSub topic to `"terminal:global"`
- [ ] Test: open terminal, verify it connects to the single VM

## Phase 7: Cleanup + Full Verification
- [ ] Remove orphaned test files for deleted components
- [ ] Update remaining tests for new architecture
- [ ] `mix precommit` passes (compile + format + test)
- [ ] `cd assets && bun run tsc --noEmit && bun run lint && bun run format:check && bun run test`
- [ ] `cd priv/sprite && bun run lint && bun run format:check && bun test`
- [ ] Manual E2E: create agent, send message, inter-agent message, shared dir, terminal, settings
