defmodule Shire.Agent.CoordinatorTest do
  use Shire.DataCase, async: false

  alias Shire.Agent.{AgentManager, Coordinator}

  defp start_agent_manager(agent_name, opts \\ []) do
    supervisor_id = Keyword.get(opts, :id, agent_name)

    start_supervised(
      {AgentManager, agent_name: agent_name, skip_sprite: true},
      id: supervisor_id
    )
  end

  @agent_name "coord-test-agent"

  describe "lookup/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.lookup("nonexistent")
    end

    test "returns {:ok, pid} for a running agent" do
      {:ok, pid} = start_agent_manager(@agent_name)
      assert {:ok, ^pid} = Coordinator.lookup(@agent_name)
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

  describe "start_agent/1 with existing agent" do
    test "attempts restart for a failed agent instead of returning already_running" do
      {:ok, _pid} = start_agent_manager(@agent_name)

      Coordinator.notify_status(@agent_name, :failed)
      assert :failed == Coordinator.agent_status(@agent_name)

      # In test env (no real sprite), restart returns {:error, :no_sprite}
      # but the key behavior is that it attempts restart rather than returning :already_running
      result = Coordinator.start_agent(@agent_name)
      assert result != {:error, :already_running}
    end

    test "still returns already_running for active agents" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      Coordinator.notify_status(@agent_name, :active)

      assert {:error, :already_running} = Coordinator.start_agent(@agent_name)
    end
  end

  describe "list_running/0" do
    test "returns empty list when no agents are running" do
      assert Coordinator.list_running() == []
    end

    test "includes running agents" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      running = Coordinator.list_running()
      assert @agent_name in running
    end
  end

  describe "agent_status/1" do
    test "returns :created for non-running agents" do
      assert :created == Coordinator.agent_status("nonexistent")
    end

    test "returns status after notify_status" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      Coordinator.notify_status(@agent_name, :active)
      assert :active == Coordinator.agent_status(@agent_name)
    end
  end

  describe "agent_statuses/1" do
    test "returns status map for given agent names" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      Coordinator.notify_status(@agent_name, :bootstrapping)

      result = Coordinator.agent_statuses([@agent_name, "nonexistent"])
      assert result[@agent_name] == :bootstrapping
      assert result["nonexistent"] == :created
    end
  end

  describe "notify_status/2 broadcasts" do
    test "broadcasts {:status, status} to agent topic" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_name}")
      Coordinator.notify_status(@agent_name, :active)
      assert_receive {:status, :active}, 10_000
    end

    test "broadcasts {:agent_status, name, status} to lobby" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agents:lobby")
      Coordinator.notify_status(@agent_name, :bootstrapping)
      assert_receive {:agent_status, _name, :bootstrapping}, 10_000
    end
  end

  describe "auto-restart on init" do
    test "handle_continue does not crash when no VM configured" do
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "excludes terminal sessions from registry" do
    test "list_running only returns agent entries" do
      {:ok, _pid} = start_agent_manager(@agent_name)

      # Simulate a terminal session registering in the same registry
      {:ok, _} =
        Registry.register(Shire.AgentRegistry, {:terminal, @agent_name}, "terminal-session")

      running = Coordinator.list_running()
      assert @agent_name in running
      refute {:terminal, @agent_name} in running
    end
  end

  describe "get_sprite/0" do
    test "returns a value (nil when no token, sprite when configured)" do
      # Just verify it doesn't crash — result depends on SPRITES_TOKEN env
      _result = Coordinator.get_sprite()
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end
end
