# AgentManager Timeout Fixes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent timeout crashes in AgentManager by making bootstrap non-blocking and adding timeouts to all bare `Sprites.cmd` calls.

**Architecture:** Move bootstrap work from `handle_continue` (which blocks the GenServer mailbox) into a `Task` that reports back via message. Add a `@cmd_timeout` default to all `Sprites.cmd` calls that currently lack one. Wrap `get_sprite` in show.ex with try-catch for robustness.

**Tech Stack:** Elixir/OTP GenServer, Task

---

## Chunk 1: Async Bootstrap + Sprites.cmd Timeouts

### Task 1: Move bootstrap to an async Task

The core issue: `handle_continue(:bootstrap, state)` does all work synchronously, blocking the GenServer for potentially minutes. Moving this to a `Task` keeps the GenServer responsive.

**Files:**
- Modify: `lib/sprite_agents/agent/agent_manager.ex`
- Modify: `test/sprite_agents/agent/agent_manager_test.exs`

- [ ] **Step 1: Write test for GenServer responsiveness during bootstrap**

Add to `agent_manager_test.exs`:

```elixir
describe "responsiveness" do
  test "get_state responds immediately even during non-idle phases", %{agent: agent} do
    {:ok, pid} =
      start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})

    # Phase is :idle with skip_sprite, but GenServer should always respond
    state = AgentManager.get_state(pid)
    assert state.phase == :idle
  end
end
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `mix test test/sprite_agents/agent/agent_manager_test.exs -v`
Expected: PASS (this is a baseline test)

- [ ] **Step 3: Refactor handle_continue(:bootstrap) to use Task**

In `agent_manager.ex`, replace `handle_continue(:bootstrap, state)` so it spawns a Task and returns immediately. The Task sends a message back on completion.

Replace the current `handle_continue(:bootstrap, state)` (lines 155-243) with:

```elixir
@impl true
def handle_continue(:bootstrap, state) do
  agent_id = state.agent_id
  sprite = state.sprite

  Task.start(fn ->
    result = run_bootstrap(agent_id, sprite)
    GenServer.cast(via(agent_id), {:bootstrap_complete, result})
  end)

  {:noreply, state}
end
```

Extract the bootstrap body into a private function:

```elixir
defp run_bootstrap(agent_id, sprite) do
  bootstrap_script =
    File.read!(Application.app_dir(:sprite_agents, "priv/sprite/bootstrap.sh"))

  {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script], timeout: 120_000)

  agent = Agents.get_agent!(agent_id)
  recipe = Agent.parse_recipe!(agent)
  secrets = Agents.effective_secrets(agent_id)

  harness = recipe["harness"] || "pi"

  default_model =
    case harness do
      "claude_code" -> "claude-sonnet-4-6"
      _ -> "anthropic/claude-sonnet-4-6"
    end

  system_prompt =
    (recipe["system_prompt"] || "You are a helpful assistant.") <> "\n\n" <> @comms_prompt

  config =
    Jason.encode!(%{
      harness: harness,
      model: recipe["model"] || default_model,
      system_prompt: system_prompt,
      max_tokens: 4096
    })

  fs = SpriteHelpers.filesystem(sprite)
  :ok = Sprites.Filesystem.write(fs, "/workspace/agent-config.json", config)
  :ok = Sprites.Filesystem.write(fs, "/workspace/peers.json", "[]")

  recipe_json = Jason.encode!(recipe)
  :ok = Sprites.Filesystem.write(fs, "/workspace/recipe.json", recipe_json)

  env_content = Enum.map_join(secrets, "\n", fn s -> "#{s.key}=#{s.value}" end)
  :ok = Sprites.Filesystem.write(fs, "/workspace/.env", env_content)

  ts_files = [
    "agent-runner.ts",
    "harness/types.ts",
    "harness/pi-harness.ts",
    "harness/claude-code-harness.ts",
    "harness/index.ts"
  ]

  for file <- ts_files do
    source = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/#{file}"))
    :ok = Sprites.Filesystem.write(fs, "/workspace/#{file}", source)
  end

  recipe_runner =
    File.read!(Application.app_dir(:sprite_agents, "priv/sprite/recipe-runner.ts"))

  :ok = Sprites.Filesystem.write(fs, "/workspace/recipe-runner.ts", recipe_runner)

  pkg_json = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/package.json"))
  :ok = Sprites.Filesystem.write(fs, "/workspace/package.json", pkg_json)

  if recipe["scripts"] && recipe["scripts"] != [] do
    Sprites.cmd(sprite, "bun", ["run", "/workspace/recipe-runner.ts"], timeout: 300_000)
  end

  {_, 0} =
    Sprites.cmd(sprite, "bash", ["-c", "cd /workspace && bun install"], timeout: 60_000)

  DriveSync.ensure_started()
  DriveSync.sync_to_agent(agent_id, sprite)

  :ok
rescue
  e -> {:error, e}
end
```

Add the cast handler for bootstrap completion:

```elixir
def handle_cast({:bootstrap_complete, :ok}, state) do
  {:noreply, state, {:continue, :spawn_runner}}
end

def handle_cast({:bootstrap_complete, {:error, e}}, state) do
  Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
  state = %{state | phase: :failed}
  broadcast(state, {:status, :failed})
  update_agent_status(state, :failed)
  {:noreply, state}
end
```

- [ ] **Step 4: Run tests**

Run: `mix test test/sprite_agents/agent/agent_manager_test.exs -v`
Expected: PASS

- [ ] **Step 5: Compile with warnings check**

Run: `mix compile --warnings-as-errors`
Expected: No warnings

### Task 2: Add timeouts to bare Sprites.cmd calls

**Files:**
- Modify: `lib/sprite_agents/agent/agent_manager.ex`

- [ ] **Step 6: Add module attribute for default cmd timeout**

Add near the top of the module (after the existing module attributes):

```elixir
@cmd_timeout 30_000
```

- [ ] **Step 7: Add timeout to all bare Sprites.cmd calls in cast handlers**

Update lines with `Sprites.cmd` that lack a `timeout:` option:

1. Drive sync write (line ~386-397): Add `timeout: @cmd_timeout` to the bash command
2. Drive delete (line ~411-416): Add `timeout: @cmd_timeout`
3. Drive create dir (line ~431): Add `timeout: @cmd_timeout`
4. Drive delete dir (line ~446): Add `timeout: @cmd_timeout`

Each `Sprites.cmd(sprite, ...)` call should become `Sprites.cmd(sprite, ..., timeout: @cmd_timeout)`.

- [ ] **Step 8: Run full test suite**

Run: `mix test`
Expected: All tests pass

- [ ] **Step 9: Compile with warnings**

Run: `mix compile --warnings-as-errors && mix format --check-formatted`
Expected: Clean

### Task 3: Add try-catch to get_sprite in LiveView

**Files:**
- Modify: `lib/sprite_agents_web/live/agent_live/show.ex`

- [ ] **Step 10: Wrap connect-terminal's get_sprite call**

The `connect-terminal` handler calls `AgentManager.get_sprite(agent.id)` which is a GenServer.call. If the agent process died between the `TerminalSession.find` check and this call, it will raise an exit. Add a catch block:

Replace lines 152-168:

```elixir
      :error ->
        try do
          case AgentManager.get_sprite(agent.id) do
            {:ok, sprite} when not is_nil(sprite) ->
              case TerminalSession.start_link(agent_id: agent.id, sprite: sprite) do
                {:ok, _pid} ->
                  Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "terminal:#{agent.id}")
                  {:noreply, socket}

                {:error, reason} ->
                  {:noreply,
                   push_event(socket, "terminal-exit", %{code: 1, error: inspect(reason)})}
              end

            _ ->
              {:noreply,
               push_event(socket, "terminal-exit", %{code: 1, error: "No sprite available"})}
          end
        catch
          :exit, _ ->
            {:noreply,
             push_event(socket, "terminal-exit", %{code: 1, error: "Agent is not running"})}
        end
    end
```

- [ ] **Step 11: Run full verification**

```bash
mix compile --warnings-as-errors
mix format --check-formatted
mix test
```

- [ ] **Step 12: Commit**

```bash
git add lib/sprite_agents/agent/agent_manager.ex lib/sprite_agents_web/live/agent_live/show.ex test/sprite_agents/agent/agent_manager_test.exs
git commit -m "fix: prevent timeout crashes in AgentManager

Move bootstrap to async Task so GenServer stays responsive during
startup. Add explicit timeouts to all bare Sprites.cmd calls in
drive cast handlers. Wrap get_sprite call in LiveView with try-catch."
```

## Verification

After all changes:
1. `mix compile --warnings-as-errors` — clean compilation
2. `mix format --check-formatted` — properly formatted
3. `mix test` — all tests pass
4. Manual: start an agent, navigate to its page during bootstrap — should not crash the LiveView
