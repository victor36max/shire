defmodule Shire.Agent.CoordinatorTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.Agent.{AgentManager, Coordinator}
  alias Shire.Projects

  setup do
    # Global mode so the Coordinator process (separate from test process) can use stubs
    Mox.set_mox_global()

    # Stub all VM calls with safe defaults before starting the Coordinator
    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
    stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
    stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
    stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

    # Create a DB-backed project
    {:ok, project} = Projects.create_project("test-project")
    project_id = project.id

    # Start the project-scoped DynamicSupervisor for agents
    start_supervised!(
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
       strategy: :one_for_one},
      id: :agent_sup
    )

    # Start the Coordinator (handle_continue runs bootstrap/deploy/scan on start)
    start_supervised!({Shire.Agent.Coordinator, project_id: project_id})

    # Give handle_continue time to complete
    Process.sleep(50)

    %{project_id: project_id}
  end

  defp broadcast_status(project_id, agent_id, status) do
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{project_id}:agent:#{agent_id}",
      {:agent_status, agent_id, status}
    )

    # Give the Coordinator time to process the async message
    Process.sleep(50)
  end

  defp start_agent_manager(project_id, agent_id, opts \\ []) do
    supervisor_id = Keyword.get(opts, :id, agent_id)

    result =
      start_supervised(
        {AgentManager,
         project_id: project_id, agent_id: agent_id, agent_name: "test-agent", skip_sprite: true},
        id: supervisor_id
      )

    # Ensure the Coordinator subscribes to this agent's topic for status relay
    Coordinator.watch_agent(project_id, agent_id)
    Process.sleep(10)

    result
  end

  defp create_db_agent(project_id, name \\ "coord-test-agent") do
    {:ok, agent} =
      Shire.Agents.create_agent_with_vm(
        project_id,
        name,
        "version: 1\nname: #{name}\n",
        Shire.VirtualMachineStub
      )

    agent
  end

  describe "lookup/2" do
    test "returns error when agent is not running", %{project_id: project_id} do
      assert {:error, :not_found} =
               Coordinator.lookup(project_id, "00000000-0000-0000-0000-000000000000")
    end

    test "returns {:ok, pid} for a running agent", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, pid} = start_agent_manager(project_id, agent.id)
      assert {:ok, ^pid} = Coordinator.lookup(project_id, agent.id)
    end
  end

  describe "delete_agent/2" do
    test "broadcasts {:agent_deleted, id} on lobby", %{project_id: project_id} do
      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents:lobby")

      agent = create_db_agent(project_id, "coord-delete-broadcast")

      Coordinator.delete_agent(project_id, agent.id)

      agent_id = agent.id
      assert_receive {:agent_deleted, ^agent_id}, 500
    end
  end

  describe "restart_agent/2" do
    test "restarts a running agent", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)

      broadcast_status(project_id, agent.id, :idle)
      assert :idle == Coordinator.agent_status(project_id, agent.id)

      # Restart should succeed for a running (idle) agent
      result = Coordinator.restart_agent(project_id, agent.id)
      assert result == :ok
    end
  end

  describe "list_running/1" do
    test "returns a list of strings", %{project_id: project_id} do
      running = Coordinator.list_running(project_id)
      assert is_list(running)
    end

    test "includes running agents", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)
      running = Coordinator.list_running(project_id)
      assert agent.id in running
    end
  end

  describe "agent_status/2" do
    test "returns :created for non-running agents", %{project_id: project_id} do
      assert :created ==
               Coordinator.agent_status(project_id, "00000000-0000-0000-0000-000000000000")
    end

    test "returns status after PubSub broadcast", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)
      broadcast_status(project_id, agent.id, :active)
      assert :active == Coordinator.agent_status(project_id, agent.id)
    end
  end

  describe "agent_statuses/2" do
    test "returns status map for given agent IDs", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)
      broadcast_status(project_id, agent.id, :bootstrapping)

      nonexistent = "00000000-0000-0000-0000-000000000000"
      result = Coordinator.agent_statuses(project_id, [agent.id, nonexistent])
      assert result[agent.id] == :bootstrapping
      assert result[nonexistent] == :created
    end
  end

  describe "status updates via PubSub" do
    test "coordinator updates internal state from agent topic broadcasts", %{
      project_id: project_id
    } do
      agent = create_db_agent(project_id)
      Coordinator.watch_agent(project_id, agent.id)
      Process.sleep(10)
      broadcast_status(project_id, agent.id, :active)
      assert :active == Coordinator.agent_status(project_id, agent.id)
    end
  end

  describe "auto-restart on init" do
    test "handle_continue does not crash the coordinator", %{project_id: project_id} do
      assert Process.alive?(
               GenServer.whereis(
                 {:via, Registry, {Shire.ProjectRegistry, {:coordinator, project_id}}}
               )
             )
    end
  end

  describe "excludes terminal sessions from registry" do
    test "list_running only returns agent entries", %{project_id: project_id} do
      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)

      # Simulate a terminal session registering in the same registry
      {:ok, _} =
        Registry.register(
          Shire.AgentRegistry,
          {:terminal, agent.id},
          "terminal-session"
        )

      running = Coordinator.list_running(project_id)
      assert agent.id in running
      refute {:terminal, agent.id} in running
    end
  end

  describe "update_agent/3" do
    test "writes recipe.yaml to the VM and returns :ok", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      agent = create_db_agent(project_id, "coord-update-test")

      result =
        Coordinator.update_agent(project_id, agent.id, %{
          "recipe_yaml" => "version: 1\nname: coord-update-test\nharness: claude_code\n"
        })

      assert result == :ok

      assert Process.alive?(
               GenServer.whereis(
                 {:via, Registry, {Shire.ProjectRegistry, {:coordinator, project_id}}}
               )
             )
    end

    test "restarts agent if it is running", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      agent = create_db_agent(project_id)
      {:ok, _pid} = start_agent_manager(project_id, agent.id)

      # Mark as active so restart is meaningful
      broadcast_status(project_id, agent.id, :active)

      result =
        Coordinator.update_agent(project_id, agent.id, %{
          "recipe_yaml" => "version: 1\nname: #{agent.name}\n"
        })

      assert result == :ok
    end

    test "broadcasts {:agent_updated, id} on lobby", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents:lobby")

      agent = create_db_agent(project_id, "coord-update-broadcast")

      Coordinator.update_agent(project_id, agent.id, %{
        "recipe_yaml" => "version: 1\nname: coord-update-broadcast\n"
      })

      agent_id = agent.id
      assert_receive {:agent_updated, ^agent_id}, 500
    end
  end

  describe "get_agent/2" do
    test "returns {:error, :not_found} when agent does not exist", %{project_id: project_id} do
      result = Coordinator.get_agent(project_id, "00000000-0000-0000-0000-000000000000")
      assert {:error, :not_found} = result
    end

    test "returns {:ok, agent} with correct fields when agent exists", %{project_id: project_id} do
      recipe_yaml = """
      name: my-agent
      description: A test agent
      harness: claude_code
      model: claude-3-haiku
      system_prompt: You are helpful.
      """

      agent = create_db_agent(project_id, "my-agent")

      stub(Shire.VirtualMachineMock, :read, fn _project, _path ->
        {:ok, recipe_yaml}
      end)

      result = Coordinator.get_agent(project_id, agent.id)

      assert {:ok, agent_data} = result
      assert agent_data.name == "my-agent"
      assert agent_data.description == "A test agent"
      assert agent_data.harness == "claude_code"
      assert agent_data.model == "claude-3-haiku"
      assert agent_data.system_prompt == "You are helpful."
      assert Map.has_key?(agent_data, :status)
    end
  end

  describe "list_agents/1" do
    test "returns agent list from DB merged with statuses", %{project_id: project_id} do
      agents = Coordinator.list_agents(project_id)
      assert is_list(agents)
    end

    test "returns agent map entries for DB agents", %{project_id: project_id} do
      create_db_agent(project_id, "agent-one")
      create_db_agent(project_id, "agent-two")

      agents = Coordinator.list_agents(project_id)
      assert is_list(agents)
      assert length(agents) >= 2

      for agent <- agents do
        assert Map.has_key?(agent, :name)
        assert Map.has_key?(agent, :status)
      end

      names = Enum.map(agents, & &1.name)
      assert "agent-one" in names
      assert "agent-two" in names
    end
  end

  describe "update_agent/3 with rename" do
    test "renames agent when recipe name differs from current name", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      agent = create_db_agent(project_id, "coord-rename-old")
      new_name = "coord-rename-new-#{System.unique_integer([:positive])}"

      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents:lobby")

      result =
        Coordinator.update_agent(project_id, agent.id, %{
          "recipe_yaml" => "version: 1\nname: #{new_name}\nharness: claude_code\n"
        })

      assert result == :ok

      agent_id = agent.id
      old_name = agent.name
      assert_receive {:agent_renamed, ^agent_id, ^old_name, ^new_name}, 500
    end

    test "returns error when target name already exists", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      agent = create_db_agent(project_id, "coord-rename-conflict-old")
      _agent2 = create_db_agent(project_id, "coord-rename-conflict-new")

      result =
        Coordinator.update_agent(project_id, agent.id, %{
          "recipe_yaml" => "version: 1\nname: coord-rename-conflict-new\n"
        })

      assert {:error, _} = result
    end
  end

  describe "vm_woke_up auto-restart" do
    test "restarts idle agents when VM wakes up", %{project_id: project_id} do
      agent = create_db_agent(project_id, "idle-agent-wake")
      {:ok, _pid} = start_agent_manager(project_id, agent.id)

      # Mark agent as idle (simulating VM sleep killed the runner)
      broadcast_status(project_id, agent.id, :idle)
      assert :idle == Coordinator.agent_status(project_id, agent.id)

      # Subscribe to see the restart status change
      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{project_id}:agent:#{agent.id}"
      )

      # Simulate VM waking up — ProjectManager calls restart_idle_agents
      Coordinator.restart_idle_agents(project_id)

      # Should receive bootstrapping status (restart triggers bootstrap)
      assert_receive {:agent_status, _, :bootstrapping}, 1_000
    end

    test "does not restart non-idle agents when VM wakes up", %{project_id: project_id} do
      agent = create_db_agent(project_id, "active-agent-wake")
      {:ok, _pid} = start_agent_manager(project_id, agent.id)

      # Mark agent as active
      broadcast_status(project_id, agent.id, :active)

      # Subscribe to see if status changes
      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{project_id}:agent:#{agent.id}"
      )

      # Simulate VM waking up — ProjectManager calls restart_idle_agents
      Coordinator.restart_idle_agents(project_id)

      # Should NOT receive any restart-related status change
      refute_receive {:agent_status, _, :bootstrapping}, 300
    end
  end

  describe "create_agent/2" do
    test "creates agent directory structure on VM and starts AgentManager", %{
      project_id: project_id
    } do
      unique_name = "coord-create-test-#{System.unique_integer([:positive])}"

      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      result =
        Coordinator.create_agent(project_id, %{
          "name" => unique_name,
          "recipe_yaml" => "version: 1\nname: #{unique_name}\ndescription: A test agent\n"
        })

      assert {:ok, pid} = result
      assert is_pid(pid)
    end

    test "returns {:error, :already_exists} for duplicate names", %{project_id: project_id} do
      unique_name = "coord-dup-test-#{System.unique_integer([:positive])}"

      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      recipe = "version: 1\nname: #{unique_name}\n"

      {:ok, _pid} =
        Coordinator.create_agent(project_id, %{"name" => unique_name, "recipe_yaml" => recipe})

      result =
        Coordinator.create_agent(project_id, %{"name" => unique_name, "recipe_yaml" => recipe})

      assert {:error, :already_exists} = result
    end

    test "returns {:error, :missing_name_or_recipe} for incomplete attrs", %{
      project_id: project_id
    } do
      result = Coordinator.create_agent(project_id, %{"name" => "no-recipe"})
      assert {:error, :missing_name_or_recipe} = result
    end

    test "rejects agent name with uppercase letters", %{project_id: project_id} do
      result =
        Coordinator.create_agent(project_id, %{
          "name" => "MyAgent",
          "recipe_yaml" => "version: 1\nname: MyAgent\n"
        })

      assert {:error, :invalid_name} = result
    end

    test "rejects agent name with spaces", %{project_id: project_id} do
      result =
        Coordinator.create_agent(project_id, %{
          "name" => "my agent",
          "recipe_yaml" => "version: 1\nname: my agent\n"
        })

      assert {:error, :invalid_name} = result
    end

    test "rejects agent name with leading dash", %{project_id: project_id} do
      result =
        Coordinator.create_agent(project_id, %{
          "name" => "-invalid",
          "recipe_yaml" => "version: 1\nname: -invalid\n"
        })

      assert {:error, :invalid_name} = result
    end

    test "rejects agent name with trailing dash", %{project_id: project_id} do
      result =
        Coordinator.create_agent(project_id, %{
          "name" => "invalid-",
          "recipe_yaml" => "version: 1\nname: invalid-\n"
        })

      assert {:error, :invalid_name} = result
    end

    test "rejects agent name with underscores", %{project_id: project_id} do
      result =
        Coordinator.create_agent(project_id, %{
          "name" => "my_agent",
          "recipe_yaml" => "version: 1\nname: my_agent\n"
        })

      assert {:error, :invalid_name} = result
    end
  end

  describe "vm_ready deploy_and_scan" do
    test "defers deploy_and_scan when VM is not running" do
      Mox.set_mox_global()

      stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

      stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
        {:error, :not_available_in_test}
      end)

      # VM reports :starting (not ready yet)
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :starting end)

      {:ok, project} = Projects.create_project("test-vm-deferred")
      project_id = project.id

      start_supervised!(
        {DynamicSupervisor,
         name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
         strategy: :one_for_one},
        id: :agent_sup_deferred
      )

      start_supervised!(
        {Shire.Agent.Coordinator, project_id: project_id},
        id: :coordinator_deferred
      )

      Process.sleep(50)

      # Coordinator should still be alive (no crash)
      assert Process.alive?(
               GenServer.whereis(
                 {:via, Registry, {Shire.ProjectRegistry, {:coordinator, project_id}}}
               )
             )
    end

    test "triggers deploy_and_scan when deploy_and_scan/1 is called" do
      Mox.set_mox_global()

      stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

      stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
        {:error, :not_available_in_test}
      end)

      # Start with VM not ready
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :starting end)

      # Track write calls to verify peers.yaml is written after vm_ready
      test_pid = self()

      stub(Shire.VirtualMachineMock, :write, fn _project, path, _content ->
        if String.ends_with?(path, "peers.yaml") do
          send(test_pid, :peers_yaml_written)
        end

        :ok
      end)

      {:ok, project} = Projects.create_project("test-vm-ready-trigger")
      project_id = project.id

      start_supervised!(
        {DynamicSupervisor,
         name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
         strategy: :one_for_one},
        id: :agent_sup_trigger
      )

      start_supervised!(
        {Shire.Agent.Coordinator, project_id: project_id},
        id: :coordinator_trigger
      )

      Process.sleep(50)

      # peers.yaml should NOT have been written yet (VM not ready)
      refute_received :peers_yaml_written

      # Now simulate VM becoming ready — ProjectManager calls deploy_and_scan
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)
      Coordinator.deploy_and_scan(project_id)

      # peers.yaml should now be written
      assert_receive :peers_yaml_written, 1_000
    end

    test "deploy_and_scan/1 is a no-op when already deployed" do
      Mox.set_mox_global()

      stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

      stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
        {:error, :not_available_in_test}
      end)

      # VM is running from the start
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

      test_pid = self()
      write_count = :counters.new(1, [:atomics])

      stub(Shire.VirtualMachineMock, :write, fn _project, path, _content ->
        if String.ends_with?(path, "peers.yaml") do
          :counters.add(write_count, 1, 1)
          send(test_pid, :peers_yaml_written)
        end

        :ok
      end)

      {:ok, project} = Projects.create_project("test-no-double-deploy")
      project_id = project.id

      start_supervised!(
        {DynamicSupervisor,
         name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
         strategy: :one_for_one},
        id: :agent_sup_no_double
      )

      start_supervised!(
        {Shire.Agent.Coordinator, project_id: project_id},
        id: :coordinator_no_double
      )

      # Wait for initial deploy (VM was running, so handle_continue deploys)
      assert_receive :peers_yaml_written, 1_000

      # Calling deploy_and_scan again should be a no-op
      Coordinator.deploy_and_scan(project_id)
      Process.sleep(50)

      assert :counters.get(write_count, 1) == 1
    end
  end

  describe "deploy_and_scan bootstrapping status propagation" do
    test "broadcasts :bootstrapping to lobby when agents start during deploy_and_scan" do
      Mox.set_mox_global()

      stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
        {:error, :not_available_in_test}
      end)

      # Start with VM not ready so deploy_and_scan defers
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :starting end)

      {:ok, project} = Projects.create_project("test-bootstrap-status")
      project_id = project.id

      # Create DB agents before starting the coordinator
      agent_one = create_db_agent(project_id, "boot-agent-one")
      agent_two = create_db_agent(project_id, "boot-agent-two")

      start_supervised!(
        {DynamicSupervisor,
         name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
         strategy: :one_for_one},
        id: :agent_sup_bootstrap
      )

      start_supervised!(
        {Shire.Agent.Coordinator, project_id: project_id},
        id: :coordinator_bootstrap
      )

      Process.sleep(50)

      # Subscribe to lobby to verify broadcasts
      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents:lobby")

      # Now simulate VM becoming ready
      stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)
      Coordinator.deploy_and_scan(project_id)

      # Lobby should receive :bootstrapping broadcasts for both agents
      # (agents may subsequently transition to :idle, but the broadcast must happen)
      agent_one_id = agent_one.id
      agent_two_id = agent_two.id
      assert_receive {:agent_status, ^agent_one_id, :bootstrapping}, 1_000
      assert_receive {:agent_status, ^agent_two_id, :bootstrapping}, 1_000
    end
  end

  describe "update_agent/3 with invalid new name" do
    test "rejects rename to an invalid slug", %{project_id: project_id} do
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      agent = create_db_agent(project_id, "coord-valid-slug")

      result =
        Coordinator.update_agent(project_id, agent.id, %{
          "recipe_yaml" => "version: 1\nname: Invalid Name!\n"
        })

      assert {:error, :invalid_name} = result
    end
  end
end
