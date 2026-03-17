# Terminal UI (xterm.js) on Agent Detail Page

## Context

Users need direct shell access to sprite VMs from the agent detail page for debugging, inspecting files, and manual intervention. The Sprites SDK already supports interactive TTY sessions via `Sprites.spawn(sprite, "bash", ["-i"], tty: true)` with stdin/stdout streaming over WebSocket, plus `Sprites.resize/3` for terminal resizing. This feature adds an xterm.js terminal as a new tab on the AgentShow page.

## Architecture

```
xterm.js ↔ LiveView pushEvent/handleEvent ↔ TerminalSession GenServer ↔ Sprites WebSocket (TTY) ↔ VM bash
```

Data flows through the existing LiveView WebSocket — no new channels or sockets needed.

## Components

### 1. TerminalSession GenServer

**File:** `lib/shire/agent/terminal_session.ex`

A GenServer that owns the Sprites TTY connection for a single agent terminal.

**Lifecycle:**
- Started on-demand when user clicks Terminal tab
- Registered via `Registry` (in `Shire.AgentRegistry`) by `{:terminal, agent_name}` key so LiveView can find/reuse an existing session
- Monitors the Sprites command — broadcasts disconnect on exit
- Stopped explicitly via `stop/1` or when the Sprites command exits

**How it gets the sprite struct:**
- Add `get_sprite/1` to `AgentManager` that returns the sprite struct from its state
- `TerminalSession.start_link/1` receives the sprite struct directly from the LiveView (which calls `AgentManager.get_sprite/1`)

**API:**
- `start_link(opts)` — opts include `agent_name` and `sprite` struct; spawns `bash -i` with TTY
- `write(pid, data)` — forwards stdin keystrokes to sprite via `Sprites.write/2`
- `resize(pid, rows, cols)` — forwards TTY resize via `Sprites.resize/3`
- `stop(pid)` — closes the TTY connection and stops the GenServer

**Internal:**
- Calls `Sprites.spawn(sprite, "bash", ["-i"], tty: true, tty_rows: 24, tty_cols: 80)`
- Receives `{:stdout, command, data}` messages from Sprites SDK
- Broadcasts on PubSub topic `"terminal:#{agent_name}"`:
  - `{:terminal_output, data}` — raw terminal bytes
  - `{:terminal_exit, code}` — session ended

### 2. AgentManager Addition

**File:** `lib/shire/agent/agent_manager.ex`

Add a new public function:

```elixir
def get_sprite(name) do
  GenServer.call(via(name), :get_sprite)
end
```

And handle_call:

```elixir
def handle_call(:get_sprite, _from, state) do
  {:reply, {:ok, state.sprite}, state}
end
```

### 3. LiveView Changes

**File:** `lib/shire_web/live/agent_live/show.ex`

New event handlers:

| Event | Direction | Action |
|-------|-----------|--------|
| `connect-terminal` | client→server | Get sprite via `AgentManager.get_sprite/1`, start or reuse `TerminalSession`, subscribe to PubSub topic |
| `disconnect-terminal` | client→server | Unsubscribe from terminal PubSub topic |
| `terminal-input` | client→server | `TerminalSession.write(pid, data)` |
| `terminal-resize` | client→server | `TerminalSession.resize(pid, rows, cols)` |

New handle_info clauses:

| Message | Action |
|---------|--------|
| `{:terminal_output, data}` | `push_event(socket, "terminal-output", %{data: Base.encode64(data)})` |
| `{:terminal_exit, code}` | `push_event(socket, "terminal-exit", %{code: code})` |

Binary terminal data is base64-encoded for transport over LiveView JSON events.

### 4. React Terminal Component

**File:** `assets/react-components/Terminal.tsx`

Wraps xterm.js with LiveView integration. Uses `useLiveReact()` hook to access `handleEvent`/`removeHandleEvent` (they are available as props from LiveReact but AgentShow currently only passes `pushEvent`).

**Behavior:**
- Mounts `@xterm/xterm` Terminal + `@xterm/addon-fit` FitAddon into a div ref
- On mount: calls `pushEvent("connect-terminal", {})` to initiate the backend session
- On unmount: calls `pushEvent("disconnect-terminal", {})` and disposes xterm
- `term.onData(data)` → `pushEvent("terminal-input", {data})`
- `handleEvent("terminal-output", ({data}) => term.write(base64decode(data)))`
- `handleEvent("terminal-exit", ...)` → show reconnect option
- `FitAddon` + `ResizeObserver` → debounced (150ms) `pushEvent("terminal-resize", {rows, cols})`
- Cleanup: `removeHandleEvent` for both listeners + dispose xterm in useEffect cleanup

### 5. AgentShow Tab UI

**File:** `assets/react-components/AgentShow.tsx`

- Add `activeTab` state: `"chat" | "terminal"`
- Tab bar below agent header with Chat/Terminal buttons
- Terminal tab only visible when agent status is `active` or `sleeping` (sprite VM confirmed to exist)
- Conditionally render existing chat view or `<Terminal>` based on active tab
- Pass `pushEvent` to Terminal component; Terminal uses `useLiveReact()` for `handleEvent`

## Dependencies

```bash
cd assets && bun add @xterm/xterm @xterm/addon-fit
```

Also need to import xterm CSS in `assets/css/app.css`:
```css
@import "@xterm/xterm/css/xterm.css";
```

## Testing

**Backend:**
- `TerminalSession` GenServer: start, write, resize, stop, handles sprite command exit
- `AgentLive.Show`: terminal events route correctly

**Frontend:**
- `Terminal.tsx`: mounts xterm, calls pushEvent on input, cleans up handleEvent listeners on unmount
- `AgentShow.tsx`: tab switching, terminal tab visibility based on agent status

**Manual verification:**
1. Start an agent → switch to Terminal tab → verify interactive bash session
2. Type commands → confirm output renders with ANSI colors
3. Resize browser → verify terminal resizes
4. Switch to Chat tab and back → terminal reconnects
5. Stop agent → terminal disconnects gracefully

## Verification Commands

```bash
mix compile --warnings-as-errors
mix format --check-formatted
mix test
cd assets && bun run tsc --noEmit
cd assets && bun run test
```
