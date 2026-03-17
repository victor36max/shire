# Race Condition Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate race conditions caused by `get_agent!` crashes when agents are deleted during operation, and remove O(n) DB lookups in hot paths by caching agent names in the Registry.

**Architecture:** Store `agent_name` as the Registry value during AgentManager registration so name-based lookups become pure Registry selects (no DB). Replace all `get_agent!` calls in coordinator/agent_manager hot paths with safe `Repo.get` that handle nil gracefully. Add `get_agent/1` to the Agents context.

**Tech Stack:** Elixir, Registry, Ecto

---

## Chunk 1: Core fixes

### Task 1: Add `Agents.get_agent/1` (non-bang)

Every race condition stems from `get_agent!` raising when an agent is deleted mid-operation. Add a safe version.

**Files:**
- Modify: `lib/shire/agents.ex:9`
- Test: `test/shire/agents_test.exs`

- [ ] **Step 1: Write the failing test**

In `test/shire/agents_test.exs`, add:

```elixir
describe "get_agent/1" do
  test "returns {:ok, agent} for existing agent" do
    {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
    assert {:ok, fetched} = Agents.get_agent(agent.id)
    assert fetched.id == agent.id
  end

  test "returns {:error, :not_found} for non-existent agent" do
    assert {:error, :not_found} = Agents.get_agent(0)
  end
end
```

If the test file doesn't have `valid_recipe/0`, add it as a private helper at the top:

```elixir
defp valid_recipe(name \\ "test-agent") do
  """
  version: 1
  name: #{name}
  harness: pi
  model: claude-sonnet-4-6
  system_prompt: Test
  """
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/shire/agents_test.exs -v`
Expected: compilation error — `Agents.get_agent/1` undefined

- [ ] **Step 3: Implement `get_agent/1`**

In `lib/shire/agents.ex`, after line 9 (`def get_agent!(id), do: Repo.get!(Agent, id)`), add:

```elixir
def get_agent(id) do
  case Repo.get(Agent, id) do
    nil -> {:error, :not_found}
    agent -> {:ok, agent}
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/shire/agents_test.exs -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/shire/agents.ex test/shire/agents_test.exs
git commit -m "feat: add Agents.get_agent/1 non-bang variant"
```

---

### Task 2: Store agent_name in Registry value

Currently `AgentManager` registers with `via(agent_id)` which stores no value metadata. Change it to store `agent_name` so the Coordinator can look up names without DB queries.

**Files:**
- Modify: `lib/shire/agent/agent_manager.ex:83,103`
- Modify: `lib/shire/agent/coordinator.ex:82-93,248-258`
- Test: `test/shire/agent/coordinator_test.exs`
- Test: `test/shire/agent/agent_manager_test.exs`

- [ ] **Step 1: Write the failing tests for name-based Registry lookup**

In `test/shire/agent/coordinator_test.exs`, add new describe blocks:

```elixir
describe "lookup_by_name/1" do
  test "returns {:ok, agent_id} for a running agent by name", %{agent: agent} do
    {:ok, _pid} = start_agent_manager(agent)
    assert {:ok, agent.id} == Coordinator.lookup_by_name("coord-test-agent")
  end

  test "returns {:error, :not_found} for unknown name" do
    assert {:error, :not_found} = Coordinator.lookup_by_name("nonexistent")
  end
end

describe "list_running_with_names/0" do
  test "returns agent_id, pid, and name", %{agent: agent} do
    {:ok, pid} = start_agent_manager(agent)
    running = Coordinator.list_running_with_names()
    assert {agent.id, pid, "coord-test-agent"} in running
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/shire/agent/coordinator_test.exs -v`
Expected: compilation error — `Coordinator.lookup_by_name/1` undefined

- [ ] **Step 3: Change AgentManager to register with agent_name as value**

In `lib/shire/agent/agent_manager.ex`, change the `via/1` function to accept an optional name:

```elixir
defp via(agent_id) do
  {:via, Registry, {Shire.AgentRegistry, agent_id}}
end

defp via(agent_id, agent_name) do
  {:via, Registry, {Shire.AgentRegistry, agent_id, agent_name}}
end
```

Change `start_link/1` (line 81-84) to register with the name:

```elixir
def start_link(opts) do
  agent = Keyword.fetch!(opts, :agent)
  recipe = Agent.parse_recipe!(agent)
  agent_name = recipe["name"] || "agent-#{agent.id}"
  GenServer.start_link(__MODULE__, opts, name: via(agent.id, agent_name))
end
```

- [ ] **Step 4: Add `lookup_by_name/1` and update `list_running/0` in Coordinator**

In `lib/shire/agent/coordinator.ex`, change `list_running/0` to include the agent_name from Registry:

```elixir
def list_running do
  Registry.select(Shire.AgentRegistry, [
    {{:"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}
  ])
end
```

This already works — the third element (`:"$3"` / the value) is ignored with `:_`. But we need a new function that returns it. Add:

```elixir
@doc "Returns all running agents as `[{agent_id, pid, agent_name}]`."
def list_running_with_names do
  Registry.select(Shire.AgentRegistry, [
    {{:"$1", :"$2", :"$3"}, [], [{{:"$1", :"$2", :"$3"}}]}
  ])
end

@doc "Look up a running agent's id by its recipe name. Registry scan, no DB queries."
def lookup_by_name(name) do
  result =
    Registry.select(Shire.AgentRegistry, [
      {{:"$1", :_, :"$2"}, [{:==, :"$2", name}], [:"$1"]}
    ])

  case result do
    [agent_id | _] -> {:ok, agent_id}
    [] -> {:error, :not_found}
  end
end
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `mix test test/shire/agent/coordinator_test.exs test/shire/agent/agent_manager_test.exs -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/shire/agent/agent_manager.ex lib/shire/agent/coordinator.ex test/shire/agent/coordinator_test.exs
git commit -m "feat: store agent_name in Registry value, add lookup_by_name"
```

---

### Task 3: Replace `find_running_agent_id_by_name` with Registry-based lookup

Remove the O(n) DB-querying `find_running_agent_id_by_name` and use `lookup_by_name` instead.

**Files:**
- Modify: `lib/shire/agent/coordinator.ex:40-80,248-266`

- [ ] **Step 1: Replace `find_running_agent_id_by_name` usages**

In `lib/shire/agent/coordinator.ex`, replace `route_agent_message/3` (lines 40-80):

```elixir
def route_agent_message(from_agent_name, to_agent_name, text) do
  case lookup_by_name(to_agent_name) do
    {:ok, to_agent_id} ->
      try do
        AgentManager.send_message(to_agent_id, text, {:agent, from_agent_name})
      catch
        :exit, reason ->
          Logger.warning(
            "Failed to route message from #{from_agent_name} to #{to_agent_name}: #{inspect(reason)}"
          )

          broadcast_to_agent(
            from_agent_name,
            {:agent_event,
             %{
               "type" => "agent_message_failed",
               "payload" => %{"to_agent" => to_agent_name, "reason" => "delivery_failed"}
             }}
          )

          {:error, :delivery_failed}
      end

    {:error, :not_found} ->
      Logger.warning("Agent #{to_agent_name} not found for message from #{from_agent_name}")

      broadcast_to_agent(
        from_agent_name,
        {:agent_event,
         %{
           "type" => "agent_message_failed",
           "payload" => %{"to_agent" => to_agent_name, "reason" => "not_running"}
         }}
      )

      {:error, :not_running}
  end
end
```

Replace `broadcast_to_agent_by_name/2` (lines 260-266) with a simpler version:

```elixir
defp broadcast_to_agent(name, message) do
  case lookup_by_name(name) do
    {:ok, agent_id} ->
      Phoenix.PubSub.broadcast(Shire.PubSub, "agent:#{agent_id}", message)

    _ ->
      :ok
  end
end
```

Delete the old `find_running_agent_id_by_name/1` and `broadcast_to_agent_by_name/2` functions entirely.

- [ ] **Step 2: Add tests for route_agent_message**

In `test/shire/agent/coordinator_test.exs`, add:

```elixir
describe "route_agent_message/3" do
  test "returns {:error, :not_running} for unknown target agent" do
    assert {:error, :not_running} =
             Coordinator.route_agent_message("sender", "nonexistent", "hello")
  end

  test "returns {:error, :not_active} when target agent is not active", %{agent: agent} do
    {:ok, _pid} = start_agent_manager(agent)

    # Agent is in :idle phase (skip_sprite), so send_message returns {:error, :not_active}
    # route_agent_message catches the exit and returns delivery_failed
    result = Coordinator.route_agent_message("sender", "coord-test-agent", "hello")
    assert result == {:error, :not_active} or result == {:error, :delivery_failed}
  end
end
```

- [ ] **Step 3: Run all tests**

Run: `mix compile --warnings-as-errors && mix test`
Expected: ALL PASS, no warnings

- [ ] **Step 4: Commit**

```bash
git add lib/shire/agent/coordinator.ex test/shire/agent/coordinator_test.exs
git commit -m "refactor: use Registry-based name lookup, remove O(n) DB queries"
```

---

### Task 4: Replace `get_agent!` with `get_agent` in broadcast paths

The `do_broadcast_peers/0` function and `request_peers` @doc now reference the `Agents` module. Replace crash-prone `get_agent!` calls.

**Files:**
- Modify: `lib/shire/agent/coordinator.ex:217-240`

- [ ] **Step 1: Write test for broadcast_peers surviving a deleted agent**

In `test/shire/agent/coordinator_test.exs`, add:

```elixir
describe "broadcast_peers/0 resilience" do
  test "survives when an agent is deleted from DB while running", %{agent: agent} do
    {:ok, _pid} = start_agent_manager(agent)

    # Delete the agent from DB while it's still registered in Registry
    Agents.delete_agent(agent)

    # Should not crash
    Coordinator.broadcast_peers()
    assert Process.alive?(GenServer.whereis(Coordinator))
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/shire/agent/coordinator_test.exs --only "survives when" -v`
Expected: FAIL with `Ecto.NoResultsError`

- [ ] **Step 3: Rewrite `do_broadcast_peers` to use `list_running_with_names` and skip deleted agents**

In `lib/shire/agent/coordinator.ex`, replace `do_broadcast_peers/0`:

```elixir
defp do_broadcast_peers do
  running = list_running_with_names()

  agent_data =
    Enum.flat_map(running, fn {agent_id, pid, agent_name} ->
      case Agents.get_agent(agent_id) do
        {:ok, agent} ->
          recipe = Agent.parse_recipe!(agent)

          [
            %{
              pid: pid,
              name: agent_name,
              description: truncate(recipe["description"] || "", 200)
            }
          ]

        {:error, :not_found} ->
          Logger.warning("Agent #{agent_id} in Registry but missing from DB, skipping")
          []
      end
    end)

  peers = Enum.map(agent_data, &%{name: &1.name, description: &1.description})

  Enum.each(agent_data, fn %{pid: pid, name: name} ->
    filtered = Enum.reject(peers, fn p -> p.name == name end)
    GenServer.cast(pid, {:update_peers, filtered})
  end)
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/shire/agent/coordinator_test.exs -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/shire/agent/coordinator.ex test/shire/agent/coordinator_test.exs
git commit -m "fix: broadcast_peers survives deleted agents using get_agent/1"
```

---

### Task 5: Make `AgentManager.update_agent_status` crash-safe

Currently `update_agent_status/2` uses `get_agent!` which crashes if the agent is deleted. This can crash the AgentManager during any phase transition.

**Files:**
- Modify: `lib/shire/agent/agent_manager.ex:502-505`
- Test: `test/shire/agent/agent_manager_test.exs`

- [ ] **Step 1: Fix `update_agent_status/2`**

In `lib/shire/agent/agent_manager.ex`, replace lines 502-505:

```elixir
defp update_agent_status(state, status) do
  case Agents.get_agent(state.agent_id) do
    {:ok, agent} ->
      Agents.update_agent_status(agent, status)

    {:error, :not_found} ->
      Logger.warning("Agent #{state.agent_id} deleted, skipping status update to #{status}")
  end
end
```

Note: `run_bootstrap/2` also calls `get_agent!` at line 417, but the entire function is already wrapped in `rescue e -> {:error, e}`, so an `Ecto.NoResultsError` safely returns `{:error, e}`. No change needed there.

- [ ] **Step 2: Run tests**

Run: `mix compile --warnings-as-errors && mix test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add lib/shire/agent/agent_manager.ex
git commit -m "fix: AgentManager.update_agent_status handles deleted agents"
```

---

### Task 6: Update `request_peers` doc and clean up dead code

**Files:**
- Modify: `lib/shire/agent/coordinator.ex:31-35`

- [ ] **Step 1: Update the `@doc` for `request_peers/1`**

Replace lines 31-35:

```elixir
@doc """
Called by AgentManager when it reaches :active phase.
Triggers a debounced broadcast to update all running agents' peer lists.
"""
```

- [ ] **Step 2: Remove `broadcast_peers/0` public wrapper if unused externally**

Check if `broadcast_peers/0` is called anywhere outside coordinator:

```bash
grep -r "broadcast_peers" lib/ test/ --include="*.ex" --include="*.exs" | grep -v coordinator
```

If only used in tests, keep it. Otherwise remove the wrapper and call `do_broadcast_peers()` directly where needed.

- [ ] **Step 3: Run full verification**

Run: `mix compile --warnings-as-errors && mix format --check-formatted && mix test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add lib/shire/agent/coordinator.ex
git commit -m "chore: clean up request_peers doc and dead code"
```

---

## Verification

After all tasks:

1. `mix compile --warnings-as-errors` — no warnings
2. `mix format --check-formatted` — formatted
3. `mix test` — all tests pass
4. Manual smoke test: start 2+ agents simultaneously, verify peers.json populates on both
5. Manual test: delete an agent from DB while it's running, verify Coordinator doesn't crash
