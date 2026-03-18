defmodule Shire.Agent.CoordinatorTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.Agent.{AgentManager, Coordinator}

  setup do
    # Global mode so the Coordinator process (separate from test process) can use stubs
    Mox.set_mox_global()

    # Stub all VM calls with safe defaults before starting the Coordinator
    stub(Shire.VirtualMachineMock, :cmd, fn _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

    # Start the Coordinator (handle_continue runs bootstrap/deploy/scan on start)
    start_supervised!(Shire.Agent.Coordinator)

    # Give handle_continue time to complete
    Process.sleep(50)

    :ok
  end

  defp broadcast_status(agent_name, status) do
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agents:lobby",
      {:agent_status, agent_name, status}
    )

    # Give the Coordinator time to process the async message
    Process.sleep(50)
  end

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

  describe "delete_agent/1" do
    test "succeeds even when agent is not running (deletes dir only)" do
      assert :ok = Coordinator.delete_agent("nonexistent")
    end
  end

  describe "restart_agent/1" do
    test "restarts a running agent" do
      {:ok, _pid} = start_agent_manager(@agent_name)

      broadcast_status(@agent_name, :failed)
      assert :failed == Coordinator.agent_status(@agent_name)

      # Restart should succeed for a running (failed) agent
      result = Coordinator.restart_agent(@agent_name)
      assert result == :ok
    end
  end

  describe "list_running/0" do
    test "returns a list of strings" do
      running = Coordinator.list_running()
      assert is_list(running)
      assert Enum.all?(running, &is_binary/1)
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

    test "returns status after PubSub broadcast" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      broadcast_status(@agent_name, :active)
      assert :active == Coordinator.agent_status(@agent_name)
    end
  end

  describe "agent_statuses/1" do
    test "returns status map for given agent names" do
      {:ok, _pid} = start_agent_manager(@agent_name)
      broadcast_status(@agent_name, :bootstrapping)

      result = Coordinator.agent_statuses([@agent_name, "nonexistent"])
      assert result[@agent_name] == :bootstrapping
      assert result["nonexistent"] == :created
    end
  end

  describe "status updates via PubSub" do
    test "coordinator updates internal state from lobby broadcasts" do
      broadcast_status(@agent_name, :active)
      assert :active == Coordinator.agent_status(@agent_name)
    end
  end

  describe "auto-restart on init" do
    test "handle_continue does not crash the coordinator" do
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

  describe "update_agent/2" do
    test "writes recipe.yaml to the VM and returns :ok" do
      stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

      unique_name = "coord-update-test-#{System.unique_integer([:positive])}"

      result =
        Coordinator.update_agent(unique_name, %{
          "recipe_yaml" => "version: 1\nname: updated\nharness: claude_code\n"
        })

      assert result == :ok
      assert Process.alive?(GenServer.whereis(Coordinator))
    end
  end

  describe "get_agent/1" do
    test "returns {:error, :not_found} when agent does not exist on VM" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "__NOT_FOUND__"}
      end)

      result = Coordinator.get_agent("coord-get-test-nonexistent")
      assert {:error, :not_found} = result
    end

    test "returns {:ok, agent} with correct fields when agent exists on VM" do
      recipe_yaml = """
      name: my-agent
      description: A test agent
      harness: claude_code
      model: claude-3-haiku
      system_prompt: You are helpful.
      """

      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, recipe_yaml}
      end)

      result = Coordinator.get_agent("my-agent")

      assert {:ok, agent} = result
      assert agent.name == "my-agent"
      assert agent.description == "A test agent"
      assert agent.harness == "claude_code"
      assert agent.model == "claude-3-haiku"
      assert agent.system_prompt == "You are helpful."
      assert Map.has_key?(agent, :status)
    end
  end

  describe "list_agents/0" do
    test "returns empty list when no agents on VM" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts -> {:ok, ""} end)

      agents = Coordinator.list_agents()
      assert agents == []
    end

    test "returns agent map entries for each discovered agent dir" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "agent-one\nagent-two\n"}
      end)

      agents = Coordinator.list_agents()
      assert is_list(agents)
      assert length(agents) == 2

      for agent <- agents do
        assert Map.has_key?(agent, :name)
        assert Map.has_key?(agent, :status)
      end

      names = Enum.map(agents, & &1.name)
      assert "agent-one" in names
      assert "agent-two" in names
    end
  end

  describe "create_agent/1" do
    test "creates agent directory structure on VM and starts AgentManager" do
      unique_name = "coord-create-test-#{System.unique_integer([:positive])}"
      agent_dir = "/workspace/agents/#{unique_name}"

      stub(Shire.VirtualMachineMock, :cmd, fn cmd, args, _opts ->
        case {cmd, args} do
          {"bash", ["-c", "test -d " <> _]} -> {:ok, "missing\n"}
          {"mkdir", _} -> {:ok, ""}
          _ -> {:ok, ""}
        end
      end)

      stub(Shire.VirtualMachineMock, :write, fn ^agent_dir <> _rest, _content -> :ok end)

      result =
        Coordinator.create_agent(%{
          "name" => unique_name,
          "recipe_yaml" => "version: 1\nname: #{unique_name}\ndescription: A test agent\n"
        })

      assert {:ok, pid} = result
      assert is_pid(pid)

      # Clean up
      Coordinator.delete_agent(unique_name)
    end

    test "returns {:error, :already_exists} for duplicate names" do
      unique_name = "coord-dup-test-#{System.unique_integer([:positive])}"
      agent_dir = "/workspace/agents/#{unique_name}"

      # First call: agent does not exist
      # Second call: agent already exists
      call_count = :counters.new(1, [])

      stub(Shire.VirtualMachineMock, :cmd, fn cmd, args, _opts ->
        case {cmd, args} do
          {"bash", ["-c", "test -d " <> _]} ->
            :counters.add(call_count, 1, 1)
            n = :counters.get(call_count, 1)
            if n <= 1, do: {:ok, "missing\n"}, else: {:ok, "exists\n"}

          {"mkdir", _} ->
            {:ok, ""}

          _ ->
            {:ok, ""}
        end
      end)

      stub(Shire.VirtualMachineMock, :write, fn ^agent_dir <> _rest, _content -> :ok end)

      recipe = "version: 1\nname: #{unique_name}\n"

      {:ok, _pid} = Coordinator.create_agent(%{"name" => unique_name, "recipe_yaml" => recipe})

      result = Coordinator.create_agent(%{"name" => unique_name, "recipe_yaml" => recipe})
      assert {:error, :already_exists} = result

      # Clean up
      Coordinator.delete_agent(unique_name)
    end

    test "returns {:error, :missing_name_or_recipe} for incomplete attrs" do
      result = Coordinator.create_agent(%{"name" => "no-recipe"})
      assert {:error, :missing_name_or_recipe} = result
    end
  end

  describe "read_env/0" do
    test "returns {:ok, string} with VM content" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "MY_VAR=hello\n"}
      end)

      assert {:ok, content} = Coordinator.read_env()
      assert content == "MY_VAR=hello\n"
    end

    test "returns {:ok, empty string} when .env does not exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, ""}
      end)

      assert {:ok, ""} = Coordinator.read_env()
    end
  end

  describe "list_scripts/0" do
    test "returns {:ok, []} when no scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts -> {:ok, ""} end)

      assert {:ok, []} = Coordinator.list_scripts()
    end

    test "returns {:ok, list} with .sh filenames when scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "deploy.sh\nsetup.sh\nreadme.txt\n"}
      end)

      assert {:ok, scripts} = Coordinator.list_scripts()
      assert "deploy.sh" in scripts
      assert "setup.sh" in scripts
      refute "readme.txt" in scripts
    end
  end
end
