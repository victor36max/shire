# Inter-Agent Communication Design

## Problem

Spawned agents are isolated — they have no awareness that other agents exist, no way to discover peers, and no mechanism to send messages to each other. The routing infrastructure exists in the Coordinator (`route_agent_message/3`) and harnesses already handle incoming `agent_message` envelopes, but agents themselves can't initiate communication.

## Design

Three interconnected pieces solve this: peer discovery, outbox-based messaging, and an internal system prompt that teaches agents the protocol.

### 1. Peer Discovery via `peers.json`

Each running agent gets a `/workspace/peers.json` file listing all other running agents. The Coordinator pushes this file to all Sprites whenever the roster changes.

**File format:**
```json
[
  {"name": "researcher", "description": "Searches the web and summarizes findings..."},
  {"name": "coder", "description": "Writes and tests code in the workspace..."}
]
```

- `name`: agent identifier used for addressing messages
- `description`: first 200 characters of the agent's `system_prompt`, truncated at the last word boundary (gives peers context on what this agent does)
- The agent's own entry is excluded from its peers list

**Update flow:**
1. Agent reaches `:active` phase → Coordinator broadcasts peer update
2. Agent stops → Coordinator broadcasts peer update
3. `Coordinator.broadcast_peers/0` collects all running agents via Registry, fetches their `system_prompt` from DB (one `get_agent_by_name!/1` call per running agent), and sends `{:update_peers, peers_list}` cast to each running AgentManager
4. Each AgentManager writes the filtered peers list (excluding self) to `/workspace/peers.json` on its Sprite
5. `broadcast_peers/0` is called asynchronously (spawned task or cast) to avoid blocking the Coordinator during filesystem writes

**Bootstrap:** An empty `[]` is written to `/workspace/peers.json` during bootstrap so agents never encounter a file-not-found error.

### 2. Outbox-Based Messaging

Agents send messages by writing JSON files to `/workspace/mailbox/outbox/`. The `agent-runner.ts` watches this directory and routes messages through the existing Coordinator pipeline.

**Outbox file format** (written by agent LLM via file tools):
```json
{"to": "researcher", "text": "Can you look up the latest API pricing?"}
```

**Routing flow:**
1. Agent's LLM writes a `.json` file to `/workspace/mailbox/outbox/`
2. `agent-runner.ts` detects the new file via `fs.watch()`
3. Agent-runner reads the file, validates that `to` (string) and `text` (string) fields exist. Invalid files emit an error event and are deleted.
4. Agent-runner emits to stdout:
   ```json
   {"type": "agent_message", "payload": {"to_agent": "researcher", "text": "..."}}
   ```
5. `AgentManager` receives stdout, parses it, calls `Coordinator.route_agent_message(from, to, text)`
6. Agent-runner deletes the outbox file after emitting

**No sequence numbering needed** — outbox is fire-and-forget. Files are processed in filesystem order.

**Concurrency:** The outbox watcher uses a flag-and-recheck pattern: after processing all current files, it re-reads the directory to catch any files written during processing. This prevents the `fs.watch` guard from dropping events.

**Error handling for routing to stopped agents:** `Coordinator.route_agent_message/3` must handle the case where the target agent is not running. It checks `lookup/1` first, and if the target is not found, it emits an `agent_message_failed` event back to the sending agent's AgentManager so the LLM knows delivery failed.

### 3. Internal System Prompt

An internal system prompt section is appended to every agent's `system_prompt` during bootstrap. It teaches the agent the communication protocol.

```
## Inter-Agent Communication

You are one of several agents running in a shared environment. You can collaborate with other agents.

### First Responder Rule
When the user sends you a message, YOU are the lead for that task. This means:
- You are responsible for delivering the final result to the user
- If the task needs capabilities other agents have, delegate to them via outbox messages
- When you receive replies from other agents, synthesize their input and present the final answer
- Never leave the user without a response — acknowledge the task, delegate if needed, then follow up with the result
- The user sees YOUR output, not the other agents' — so always produce the complete final response

### Discovering Peers
Read `/workspace/peers.json` to see which other agents are currently running. Each entry has:
- `name`: the agent's identifier (use this in messages)
- `description`: what the agent does

This file is updated automatically when agents start or stop.

### Sending Messages
To send a message to another agent, write a JSON file to `/workspace/mailbox/outbox/`:

File: `/workspace/mailbox/outbox/<anything>.json`
Format: {"to": "<agent-name>", "text": "<your message>"}

The message will be delivered to the other agent automatically and the file will be cleaned up.

### Receiving Messages
Messages from other agents arrive in your normal conversation flow, prefixed with [Message from agent "<name>"].
If you are the lead (user messaged you), incorporate the agent's reply into your final response to the user.
If another agent asked you for help, send your result back via a new outbox message.

### Guidelines
- Check peers.json before messaging to confirm the agent exists
- Be specific about what you need from the other agent
- Don't send messages unnecessarily — only when collaboration genuinely helps the task
```

**Injection point:** `AgentManager.handle_continue(:bootstrap)` appends this block to the configured `system_prompt` when writing `agent-config.json`. The template is a module attribute `@comms_prompt` in AgentManager.

## Files to Modify

| File | Change |
|------|--------|
| `lib/shire/agent/coordinator.ex` | Add `broadcast_peers/0` (async), add error handling to `route_agent_message/3`, call broadcast after start/stop |
| `lib/shire/agent/agent_manager.ex` | Add `handle_cast({:update_peers, peers})`, write peers.json; append comms prompt in bootstrap; write empty peers.json in bootstrap |
| `priv/sprite/agent-runner.ts` | Add `OUTBOX_DIR`, `processOutbox()`, outbox watcher with flag-and-recheck pattern |

## Verification

1. `mix compile --warnings-as-errors` — no warnings
2. `mix format --check-formatted` — formatting OK
3. `mix test` — all Elixir tests pass
4. `cd assets && bun run tsc --noEmit` — TypeScript compiles
5. `cd assets && bun run test` — Vitest tests pass
6. Manual: start two agents, verify peers.json on each Sprite, test outbox messaging between agents, stop one and verify peers.json updates
