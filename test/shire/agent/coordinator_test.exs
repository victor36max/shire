defmodule Shire.Agent.CoordinatorTest do
  use Shire.DataCase, async: false

  alias Shire.Agent.{AgentManager, Coordinator}

  defp start_agent_manager(agent_name, agent_id, opts \\ []) do
    supervisor_id = Keyword.get(opts, :id, agent_id)

    start_supervised(
      {AgentManager, agent_name: agent_name, agent_id: agent_id, skip_sprite: true},
      id: supervisor_id
    )
  end

  @agent_name "coord-test-agent"
  @agent_id 9999

  describe "lookup/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.lookup("nonexistent")
    end

    test "returns {:ok, pid} for a running agent" do
      {:ok, pid} = start_agent_manager(@agent_name, @agent_id)
      assert {:ok, ^pid} = Coordinator.lookup(@agent_id)
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

  describe "start_agent/1 with failed agent" do
    test "restarts a failed agent instead of returning already_running" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)

      # Simulate the agent entering a failed state
      Coordinator.notify_status(@agent_id, :failed)
      assert :failed == Coordinator.agent_status(@agent_id)

      # start_agent should restart it instead of returning :already_running
      result = Coordinator.start_agent(@agent_id)
      assert {:ok, :restarted} = result
    end

    test "still returns already_running for active agents" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)
      Coordinator.notify_status(@agent_id, :active)

      assert {:error, :already_running} = Coordinator.start_agent(@agent_id)
    end
  end

  describe "list_running/0" do
    test "returns empty list when no agents are running" do
      assert Coordinator.list_running() == []
    end

    test "includes running agents" do
      {:ok, pid} = start_agent_manager(@agent_name, @agent_id)
      running = Coordinator.list_running()
      assert {@agent_id, pid} in running
    end
  end

  describe "request_peers/1" do
    test "does not crash the coordinator" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)

      # request_peers is a cast — should not crash
      Coordinator.request_peers(@agent_id)
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

    test "does not crash when agents are registered" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)
      Coordinator.broadcast_peers()
    end
  end

  describe "lookup_by_name/1" do
    test "returns {:ok, agent_id} for a running agent by name" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)
      assert {:ok, @agent_id} == Coordinator.lookup_by_name(@agent_name)
    end

    test "returns {:error, :not_found} for unknown name" do
      assert {:error, :not_found} = Coordinator.lookup_by_name("nonexistent")
    end
  end

  describe "list_running_with_names/0" do
    test "returns agent_id, pid, and name" do
      {:ok, pid} = start_agent_manager(@agent_name, @agent_id)
      running = Coordinator.list_running_with_names()
      assert {@agent_id, pid, @agent_name} in running
    end
  end

  describe "route_agent_message/3" do
    test "returns {:error, :not_running} for unknown target agent" do
      assert {:error, :not_running} =
               Coordinator.route_agent_message("sender", "nonexistent", "hello")
    end

    test "returns error when target agent is not active" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)

      # Agent is in :idle phase (skip_sprite), so send_message returns {:error, :not_active}
      result = Coordinator.route_agent_message("sender", @agent_name, "hello")
      assert result == {:error, :not_active} or result == {:error, :delivery_failed}
    end
  end

  describe "broadcast_peers/0 resilience" do
    test "survives when agents are running" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)

      # Should not crash
      Coordinator.broadcast_peers()
      assert Process.alive?(GenServer.whereis(Coordinator))
    end

    test "excludes terminal sessions from registry queries" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)

      # Simulate a terminal session registering in the same registry
      {:ok, _} =
        Registry.register(Shire.AgentRegistry, {:terminal, @agent_id}, "terminal-session")

      # list_running should only return agent entries, not terminal entries
      running = Coordinator.list_running()
      running_keys = Enum.map(running, fn {key, _pid} -> key end)
      assert @agent_id in running_keys
      refute {:terminal, @agent_id} in running_keys

      # list_running_with_names should also exclude terminal entries
      running_names = Coordinator.list_running_with_names()
      running_name_keys = Enum.map(running_names, fn {key, _pid, _name} -> key end)
      assert @agent_id in running_name_keys
      refute {:terminal, @agent_id} in running_name_keys

      # broadcast_peers should not crash
      Coordinator.broadcast_peers()
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "agent_status/1" do
    test "returns :created for non-running agents" do
      assert :created == Coordinator.agent_status("nonexistent")
    end

    test "returns status after notify_status" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)
      Coordinator.notify_status(@agent_id, :active)
      assert :active == Coordinator.agent_status(@agent_id)
    end
  end

  describe "agent_statuses/1" do
    test "returns status map for given agent IDs" do
      {:ok, _pid} = start_agent_manager(@agent_name, @agent_id)
      Coordinator.notify_status(@agent_id, :bootstrapping)

      result = Coordinator.agent_statuses([@agent_id, "nonexistent"])
      assert result[@agent_id] == :bootstrapping
      assert result["nonexistent"] == :created
    end
  end

  describe "notify_status/2 broadcasts" do
    test "broadcasts {:status, status} to agent topic" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_id}")
      Coordinator.notify_status(@agent_id, :active)
      assert_receive {:status, :active}
    end

    test "broadcasts {:agent_status, id, status} to lobby" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agents:lobby")
      Coordinator.notify_status(@agent_id, :bootstrapping)
      assert_receive {:agent_status, _id, :bootstrapping}
    end
  end

  describe "auto-restart on init" do
    test "handle_continue does not crash when no agents exist" do
      # Clean slate — the singleton Coordinator already survived init
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "debounced peer broadcast" do
    test "coordinator remains healthy after rapid request_peers calls" do
      {:ok, _} = start_agent_manager("debounce-one", 10001, id: :db1)
      {:ok, _} = start_agent_manager("debounce-two", 10002, id: :db2)

      # Fire multiple rapid requests — should debounce into fewer broadcasts
      Coordinator.request_peers(10001)
      Coordinator.request_peers(10002)
      Coordinator.request_peers(10001)

      # Wait for debounce window (500ms) + processing
      Process.sleep(700)

      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end
end
