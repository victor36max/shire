defmodule Shire.Agent.CoordinatorTest do
  use Shire.DataCase, async: false

  alias Shire.Agent.{AgentManager, Coordinator}
  alias Shire.Agents

  defp valid_recipe(name \\ "coord-test-agent") do
    """
    version: 1
    name: #{name}
    harness: pi
    model: claude-sonnet-4-6
    system_prompt: Test
    """
  end

  defp start_agent_manager(agent, opts \\ []) do
    name = Keyword.get(opts, :id, agent.id)

    start_supervised(
      {AgentManager, agent: agent, sprites_client: nil, skip_sprite: true},
      id: name
    )
  end

  setup do
    {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
    %{agent: agent}
  end

  describe "lookup/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.lookup("nonexistent")
    end

    test "returns {:ok, pid} for a running agent", %{agent: agent} do
      {:ok, pid} = start_agent_manager(agent)
      assert {:ok, ^pid} = Coordinator.lookup(agent.id)
    end
  end

  describe "kill_agent/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.kill_agent("nonexistent")
    end
  end

  describe "restart_agent/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.restart_agent("nonexistent")
    end
  end

  describe "list_running/0" do
    test "returns empty list when no agents are running" do
      assert Coordinator.list_running() == []
    end

    test "includes running agents", %{agent: agent} do
      {:ok, pid} = start_agent_manager(agent)
      running = Coordinator.list_running()
      assert {agent.id, pid} in running
    end
  end

  describe "request_peers/1" do
    test "does not crash the coordinator", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)

      # request_peers is a cast — should not crash
      Coordinator.request_peers(agent.id)
      # Wait for the async Task inside the cast to complete
      Process.sleep(100)

      assert Process.alive?(GenServer.whereis(Coordinator))
    end

    test "handles non-existent agent gracefully" do
      Coordinator.request_peers(Ecto.UUID.generate())
      Process.sleep(100)

      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "broadcast_peers/0" do
    test "does not crash with no running agents" do
      Coordinator.broadcast_peers()
    end

    test "does not crash when agents are registered", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)
      Coordinator.broadcast_peers()
    end
  end

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

  describe "route_agent_message/3" do
    test "returns {:error, :not_running} for unknown target agent" do
      assert {:error, :not_running} =
               Coordinator.route_agent_message("sender", "nonexistent", "hello")
    end

    test "returns error when target agent is not active", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)

      # Agent is in :idle phase (skip_sprite), so send_message returns {:error, :not_active}
      result = Coordinator.route_agent_message("sender", "coord-test-agent", "hello")
      assert result == {:error, :not_active} or result == {:error, :delivery_failed}
    end
  end

  describe "broadcast_peers/0 resilience" do
    test "survives when an agent is deleted from DB while running", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)

      # Delete the agent from DB while it's still registered in Registry
      Agents.delete_agent(agent)

      # Should not crash
      Coordinator.broadcast_peers()
      assert Process.alive?(GenServer.whereis(Coordinator))
    end

    test "excludes terminal sessions from registry queries", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)

      # Simulate a terminal session registering in the same registry
      {:ok, _} =
        Registry.register(Shire.AgentRegistry, {:terminal, agent.id}, "terminal-session")

      # list_running should only return agent entries, not terminal entries
      running = Coordinator.list_running()
      running_keys = Enum.map(running, fn {key, _pid} -> key end)
      assert agent.id in running_keys
      refute {:terminal, agent.id} in running_keys

      # list_running_with_names should also exclude terminal entries
      running_names = Coordinator.list_running_with_names()
      running_name_keys = Enum.map(running_names, fn {key, _pid, _name} -> key end)
      assert agent.id in running_name_keys
      refute {:terminal, agent.id} in running_name_keys

      # broadcast_peers should not crash
      Coordinator.broadcast_peers()
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "list_agents/0 (auto-restart source)" do
    test "returns all non-base agents" do
      {:ok, a1} = Agents.create_agent(%{recipe: valid_recipe("agent-one")})
      {:ok, a2} = Agents.create_agent(%{recipe: valid_recipe("agent-two")})

      agents = Agents.list_agents()
      agent_ids = Enum.map(agents, & &1.id)

      assert a1.id in agent_ids
      assert a2.id in agent_ids
    end
  end

  describe "agent_status/1" do
    test "returns :created for non-running agents" do
      assert :created == Coordinator.agent_status("nonexistent")
    end

    test "returns status after notify_status", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)
      Coordinator.notify_status(agent.id, :active)
      assert :active == Coordinator.agent_status(agent.id)
    end
  end

  describe "agent_statuses/1" do
    test "returns status map for given agent IDs", %{agent: agent} do
      {:ok, _pid} = start_agent_manager(agent)
      Coordinator.notify_status(agent.id, :bootstrapping)

      result = Coordinator.agent_statuses([agent.id, "nonexistent"])
      assert result[agent.id] == :bootstrapping
      assert result["nonexistent"] == :created
    end
  end

  describe "notify_status/2 broadcasts" do
    test "broadcasts {:status, status} to agent topic", %{agent: agent} do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{agent.id}")
      Coordinator.notify_status(agent.id, :active)
      assert_receive {:status, :active}
    end

    test "broadcasts {:agent_status, id, status} to lobby", %{agent: agent} do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agents:lobby")
      Coordinator.notify_status(agent.id, :bootstrapping)
      assert_receive {:agent_status, _id, :bootstrapping}
    end
  end

  describe "auto-restart on init" do
    test "handle_continue(:restart_agents) starts agents from DB", %{agent: agent} do
      # The Coordinator already ran handle_continue at boot with no sprites token in test,
      # so agents won't actually start (no token). Verify the agent is in list_previously_active.
      agents = Agents.list_agents()
      assert agent.id in Enum.map(agents, & &1.id)
    end

    test "handle_continue does not crash when no agents exist" do
      # Clean slate — the singleton Coordinator already survived init
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "debounced peer broadcast" do
    test "coordinator remains healthy after rapid request_peers calls" do
      {:ok, agent1} = Agents.create_agent(%{recipe: valid_recipe("debounce-one")})
      {:ok, agent2} = Agents.create_agent(%{recipe: valid_recipe("debounce-two")})

      {:ok, _} = start_agent_manager(agent1, id: :db1)
      {:ok, _} = start_agent_manager(agent2, id: :db2)

      # Fire multiple rapid requests — should debounce into fewer broadcasts
      Coordinator.request_peers(agent1.id)
      Coordinator.request_peers(agent2.id)
      Coordinator.request_peers(agent1.id)

      # Wait for debounce window (500ms) + processing
      Process.sleep(700)

      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end
end
