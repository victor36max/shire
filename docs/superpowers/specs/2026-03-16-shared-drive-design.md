# Shared Drive Design

## Context

Agents currently run in fully isolated Sprite VMs with no shared filesystem. The only inter-agent communication is message passing (outbox/inbox JSON files). This limits collaboration — agents can't share project files, knowledge bases, or build artifacts.

**Goal:** Add a single shared drive (a dedicated Sprite VM) that all agents can read/write. Files written by one agent appear automatically in all others. The Elixir app stays stateless — the drive Sprite is the source of truth.

## Architecture

### The Shared Drive Sprite

A single Sprite VM named `flyagents-shared-drive` acts as the persistent filesystem. It runs no daemon — just holds files. The Elixir app reads/writes to it via the existing `Sprites.Filesystem` API. The name is configurable via `config :sprite_agents, :shared_drive_name` (defaults to `"flyagents-shared-drive"`).

```
Agent VM A                 Elixir (relay)              Shared Drive Sprite
/workspace/shared/  ←→   AgentManager / DriveSync  ←→  /drive/
```

### Sync Flow: Agent Writes a File

1. Agent writes to `/workspace/shared/report.md`
2. `agent-runner.ts` detects change via `fs.watch` (recursive on `/workspace/shared/`)
3. Debounces 300ms, then emits: `{"type": "drive_write", "payload": {"path": "report.md", "content": "<base64>"}}`
4. `AgentManager` receives stdout event, calls `DriveSync.file_changed(agent_id, path, content)`
5. `DriveSync` writes to shared drive Sprite: `Sprites.Filesystem.write(drive_fs, "/drive/report.md", content)`
6. `DriveSync` fans out to all OTHER running agents by sending `GenServer.cast` to each `AgentManager` via the Registry (`{:via, Registry, {SpriteAgents.AgentRegistry, agent_id}}`)
7. Each target `AgentManager` writes the sync marker and file atomically on its own Sprite (see Echo Prevention below)

### Sync Flow: Agent Deletes a File

Same flow but event type is `drive_delete`, payload is `{"path": "report.md"}`. DriveSync deletes from drive Sprite via `Sprites.Filesystem.rm/2` and fans out deletion to all other agents.

### Sync Marker (Echo Prevention)

When an AgentManager receives an incoming synced file, it writes both the marker and file atomically via a single `Sprites.cmd` call to avoid race conditions between two separate HTTP calls:

```elixir
# Atomic marker + file write to prevent echo loops
Sprites.cmd(sprite, "bash", ["-c", """
  mkdir -p /workspace/.drive-sync/$(dirname '#{path}')
  touch /workspace/.drive-sync/#{path}
  mkdir -p $(dirname '/workspace/shared/#{path}')
  cat > /workspace/shared/#{path}
"""], stdin: content)
```

The `agent-runner.ts` watcher checks for the marker before emitting. If found, deletes marker and skips.

For deletes, same pattern: write marker, then `rm -f` the file, in a single cmd call.

## Components

### 1. DriveSync GenServer (`lib/sprite_agents/agent/drive_sync.ex`)

Singleton GenServer managing the shared drive Sprite and file synchronization. Registered as `SpriteAgents.Agent.DriveSync`.

**State:**
```elixir
%{
  sprites_client: client,      # obtained from Application.get_env(:sprite_agents, :sprites_token)
  sprite: sprite | nil,        # the shared drive Sprite
  drive_fs: filesystem | nil   # cached filesystem handle (uses patched client workaround)
}
```

**Note:** The `drive_fs` handle must use the same URL-patching workaround as `AgentManager.filesystem/1` (appending `/v1/sprites/{name}` to the base URL). Extract this into a shared helper `SpriteAgents.Agent.SpriteHelpers.filesystem/1` so both modules use it.

**Initialization:** In `init/1`, read the Sprites token from app config. If no token is configured (dev/test without Sprites access), start in a degraded state where all operations return `{:error, :no_sprites}`.

**Public API:**
- `ensure_started()` — creates or gets the shared drive Sprite, creates `/drive/` dir
- `file_changed(agent_id, path, content)` — write to drive + fan out to other agents
- `file_deleted(agent_id, path)` — delete from drive + fan out
- `sync_to_agent(agent_id, sprite)` — push all drive files to an agent (called during bootstrap). Uses `Task.async_stream` with max_concurrency of 5 for parallel file writes.
- `list_files()` — recursively list all files on the drive via `Sprites.cmd(sprite, "find", ["/drive", "-type", "f"])` (for UI)
- `read_file(path)` — read a file from the drive (for UI)

**No debouncing in DriveSync.** The agent-runner already debounces at 300ms. DriveSync processes writes immediately since the agent has already coalesced rapid writes.

**Fan-out:** Queries the AgentRegistry for all running agents, excludes the originator, sends `GenServer.cast(via(agent_id), {:drive_sync, path, content})` to each. Each AgentManager handles the actual filesystem write on its own Sprite.

**PubSub:** After completing a write/delete + fan-out, broadcasts `{:drive_changed, path, :write | :delete}` to the `"shared-drive"` PubSub topic so the LiveView can update.

### 2. Shared Filesystem Helper (`lib/sprite_agents/agent/sprite_helpers.ex`)

Extract the filesystem SDK workaround from `AgentManager`:

```elixir
defmodule SpriteAgents.Agent.SpriteHelpers do
  def filesystem(sprite) do
    prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
    patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
    patched_client = %{sprite.client | req: patched_req}
    patched_sprite = %{sprite | client: patched_client}
    Sprites.filesystem(patched_sprite)
  end
end
```

Both `AgentManager` and `DriveSync` use this helper.

### 3. AgentManager Changes (`lib/sprite_agents/agent/agent_manager.ex`)

**Bootstrap additions** (in `handle_continue(:bootstrap)`, after deploying files and before spawning runner):
- Call `DriveSync.sync_to_agent(agent_id, sprite)` to push existing shared files
- This happens before agent-runner starts, so no race

**New stdout event handler** (in `handle_info {:stdout, ...}`):
```elixir
{:ok, %{"type" => "drive_write", "payload" => %{"path" => path, "content" => content}}} ->
  DriveSync.file_changed(state.agent_id, path, Base.decode64!(content))

{:ok, %{"type" => "drive_delete", "payload" => %{"path" => path}}} ->
  DriveSync.file_deleted(state.agent_id, path)
```

**New cast for incoming synced files:**
```elixir
def handle_cast({:drive_sync, path, content}, %{sprite: sprite} = state) when not is_nil(sprite) do
  # Atomic write: marker + file in single cmd to prevent echo loop
  Sprites.cmd(sprite, "bash", ["-c", """
    mkdir -p /workspace/.drive-sync/$(dirname '#{path}') && \
    touch '/workspace/.drive-sync/#{path}' && \
    mkdir -p $(dirname '/workspace/shared/#{path}') && \
    cat > '/workspace/shared/#{path}'
  """], stdin: content)
  {:noreply, state}
end

def handle_cast({:drive_delete, path}, %{sprite: sprite} = state) when not is_nil(sprite) do
  Sprites.cmd(sprite, "bash", ["-c", """
    mkdir -p /workspace/.drive-sync/$(dirname '#{path}') && \
    touch '/workspace/.drive-sync/#{path}' && \
    rm -f '/workspace/shared/#{path}'
  """])
  {:noreply, state}
end
```

**Replace private `filesystem/1`** with `SpriteHelpers.filesystem/1`.

### 4. agent-runner.ts Changes (`priv/sprite/agent-runner.ts`)

Add shared directory watcher in `main()`:

```typescript
import { existsSync } from "fs";
import { mkdir, stat } from "fs/promises";

const SHARED_DIR = "/workspace/shared";
const SYNC_MARKER_DIR = "/workspace/.drive-sync";
const MAX_FILE_SIZE = 1_000_000; // 1MB limit for v1

// Debounce map: path -> timeout
const pendingSharedWrites = new Map<string, Timer>();

const sharedWatcher = watch(SHARED_DIR, { recursive: true }, async (_event, filename) => {
  if (!filename) return;

  // Check for sync marker (incoming sync, not agent write)
  const markerPath = join(SYNC_MARKER_DIR, filename);
  try {
    await readFile(markerPath);
    await unlink(markerPath);  // consume marker
    return;  // skip — this was an incoming sync
  } catch {
    // no marker = agent-originated write, continue
  }

  // Debounce 300ms
  const existing = pendingSharedWrites.get(filename);
  if (existing) clearTimeout(existing);

  pendingSharedWrites.set(filename, setTimeout(async () => {
    pendingSharedWrites.delete(filename);
    const filePath = join(SHARED_DIR, filename);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE) {
        emit("drive_error", { path: filename, message: `File exceeds ${MAX_FILE_SIZE} byte limit` });
        return;
      }
      const content = await readFile(filePath);
      emit("drive_write", { path: filename, content: content.toString("base64") });
    } catch {
      // File was deleted or unreadable
      emit("drive_delete", { path: filename });
    }
  }, 300));
});

// Clean up on shutdown
process.on("SIGTERM", () => {
  sharedWatcher.close();
  // ... existing cleanup
});
```

### 5. bootstrap.sh Changes (`priv/sprite/bootstrap.sh`)

Add:
```bash
mkdir -p /workspace/shared
mkdir -p /workspace/.drive-sync
```

### 6. System Prompt Addition

Append to `@comms_prompt` in AgentManager:

```
## Shared Drive

All agents share a drive mounted at `/workspace/shared/`. Files you write here are automatically synced to all other running agents, and their writes appear here too.

### Usage
- Read/write files normally in `/workspace/shared/`
- Changes sync automatically — no special protocol needed
- Use it for project files, documentation, research, build artifacts, or any shared data
- Avoid rapid sequential writes to the same file — batch your changes when possible
- If a file changed unexpectedly, another agent may have updated it — re-read before overwriting
- Maximum file size: 1MB per file
```

### 7. UI: Top-Level Shared Drive Page

The shared drive is a top-level page at `/shared` — not nested under agents.

**Route** (in `router.ex`):
```elixir
live "/shared", SharedDriveLive.Index, :index
```

**LiveView** (`lib/sprite_agents_web/live/shared_drive_live/index.ex`):
- Assigns: `files` (list of `%{path, size, modified_at}`), `current_path` (for directory navigation, defaults to `/`)
- Calls `DriveSync.list_files(current_path)` for directory listing (not recursive — one level at a time)
- Subscribes to PubSub topic `"shared-drive"` for real-time updates
- Handles events:
  - `navigate` — change `current_path`, refresh file list
  - `upload-file` — receive file via LiveView uploads, write to drive Sprite via `DriveSync.write_file/2`, fan out to agents
  - `create-directory` — create dir on drive Sprite via `DriveSync.create_dir/1`, fan out
  - `delete-file` — delete from drive Sprite via `DriveSync.delete_file/1`, fan out
  - `delete-directory` — `DriveSync.delete_dir/1` (recursive), fan out
- Download: standard Phoenix controller endpoint at `/shared/download?path=...` that reads file from drive Sprite and streams it

**Download controller** (`lib/sprite_agents_web/controllers/shared_drive_controller.ex`):
```elixir
def download(conn, %{"path" => path}) do
  case DriveSync.read_file(path) do
    {:ok, content} ->
      filename = Path.basename(path)
      conn
      |> put_resp_content_disposition("attachment", filename: filename)
      |> put_resp_content_type(MIME.from_path(path))
      |> send_resp(200, content)
    {:error, _} ->
      conn |> put_status(404) |> text("File not found")
  end
end
```

**React** (`assets/react-components/SharedDrive.tsx`):
Full file manager component with:
- **Breadcrumb navigation** — click path segments to navigate up
- **File/directory table** — icon (folder/file), name, size, modified date, actions column
- **Actions per item**: download (files), delete (files + dirs with confirmation)
- **Toolbar**: upload button (opens file picker), new folder button (opens dialog), current path display
- **Upload**: uses LiveView file uploads (`allow_upload` in LiveView, `<.live_file_input>` bridged to React)
- Uses shadcn Table, Button, Dialog, AlertDialog, Breadcrumb, Input components
- `pushEvent` for all mutations (upload, delete, create-dir, navigate)

**DriveSync additions** for user-initiated file operations:
- `write_file(path, content)` — write to drive Sprite + fan out to all running agents
- `create_dir(path)` — create directory on drive Sprite + fan out
- `delete_file(path)` — delete from drive Sprite + fan out
- `delete_dir(path)` — recursive delete on drive Sprite + fan out
- `list_files(path)` — single-level listing (dirs + files with metadata) instead of recursive. Uses `Sprites.cmd(sprite, "ls", ["-la", "/drive/#{path}"])` or similar.

### 8. Supervision

Add `DriveSync` to the application supervision tree in `application.ex`, before the Coordinator. DriveSync handles the no-token case gracefully (degraded mode).

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No agents running, drive Sprite exists | Files persist on the drive Sprite. Next agent to start gets them via `sync_to_agent`. |
| Agent starts while others are running | `sync_to_agent` pushes current drive state during bootstrap (max_concurrency: 5 for parallel writes). |
| Two agents write same file simultaneously | Last-write-wins at the drive Sprite level. Both versions propagate but the last one sticks. |
| Large files (>1MB) | Rejected at agent-runner level — emits `drive_error` event. Base64 over JSONL adds ~33% overhead. |
| Nested directories | Supported. `fs.watch` recursive handles subdirs. `Sprites.Filesystem.write` creates parent dirs automatically. Marker paths mirror the structure via `mkdir -p`. |
| Drive Sprite goes down | DriveSync detects failure, attempts recreate. Running agents keep their local copy. Resync on recovery. |
| File watcher misses events | Acceptable for v1. Could add periodic reconciliation sweep later. |
| No Sprites token (dev/test) | DriveSync starts in degraded mode. All operations return `{:error, :no_sprites}`. |

## Files to Create/Modify

| File | Action |
|------|--------|
| `lib/sprite_agents/agent/drive_sync.ex` | **Create** — DriveSync GenServer |
| `lib/sprite_agents/agent/sprite_helpers.ex` | **Create** — shared filesystem() workaround helper |
| `lib/sprite_agents/agent/agent_manager.ex` | **Modify** — bootstrap sync, stdout events, incoming sync casts, use SpriteHelpers |
| `priv/sprite/agent-runner.ts` | **Modify** — add shared dir watcher with debounce + sync markers |
| `priv/sprite/bootstrap.sh` | **Modify** — add `shared/` and `.drive-sync/` dirs |
| `lib/sprite_agents/application.ex` | **Modify** — add DriveSync to supervision tree |
| `lib/sprite_agents_web/router.ex` | **Modify** — add `/shared` route + download endpoint |
| `lib/sprite_agents_web/live/shared_drive_live/index.ex` | **Create** — SharedDrive LiveView |
| `lib/sprite_agents_web/controllers/shared_drive_controller.ex` | **Create** — download endpoint |
| `assets/react-components/SharedDrive.tsx` | **Create** — full file manager React component |
| `assets/react-components/index.ts` | **Modify** — export SharedDrive |
| `assets/react-components/types.ts` | **Modify** — add SharedDriveFile type |
| `test/sprite_agents/agent/drive_sync_test.exs` | **Create** — DriveSync unit tests |
| `test/sprite_agents/agent/agent_manager_test.exs` | **Modify** — test drive sync events |
| `assets/test/SharedDrive.test.tsx` | **Create** — SharedDrive component tests |

## Implementation Order

1. `sprite_helpers.ex` — extract filesystem workaround, update AgentManager to use it
2. `bootstrap.sh` — add shared + sync marker dirs
3. `drive_sync.ex` + supervision — GenServer with Sprite management, file ops, fan-out, user-initiated ops
4. `agent_manager.ex` — bootstrap integration, stdout event handling, sync casts
5. `agent-runner.ts` — shared dir watcher with debounce + marker logic
6. System prompt — add shared drive section
7. Router + LiveView + controller — `/shared` route, SharedDriveLive, download endpoint
8. React — `SharedDrive.tsx` full file manager component
9. Tests

## Verification

1. Start two agents
2. On agent A's terminal, create a file: `echo "hello" > /workspace/shared/test.txt`
3. Verify it appears on agent B: `cat /workspace/shared/test.txt`
4. On agent B, modify it: `echo "world" >> /workspace/shared/test.txt`
5. Verify agent A sees the change
6. Stop both agents, start a new agent C — verify `test.txt` persists from the drive Sprite
7. Run `mix test` and `cd assets && bun run test`
