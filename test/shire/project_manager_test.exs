defmodule Shire.ProjectManagerTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.ProjectManager

  setup do
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

    stub(Shire.VirtualMachineMock, :destroy_vm, fn _name -> :ok end)
    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

    start_supervised!(ProjectManager)

    on_exit(fn ->
      # Clean up any ProjectInstanceSupervisors started under the app-level DynamicSupervisor.
      # The supervisor may already be down (e.g. killed in a test), so handle that gracefully.
      try do
        for {_, pid, _, _} <- DynamicSupervisor.which_children(Shire.ProjectSupervisor),
            is_pid(pid) do
          DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, pid)
        end
      catch
        :exit, _ -> :ok
      end
    end)

    :ok
  end

  describe "list_projects/0" do
    test "returns empty list when no projects exist" do
      assert ProjectManager.list_projects() == []
    end

    test "returns projects with :running status after creation" do
      {:ok, project} = ProjectManager.create_project("my-project")

      projects = ProjectManager.list_projects()
      assert length(projects) == 1
      assert hd(projects).name == "my-project"
      assert hd(projects).id == project.id
      assert hd(projects).status == :running
    end
  end

  describe "create_project/1" do
    test "creates a project and returns {:ok, project}" do
      assert {:ok, project} = ProjectManager.create_project("test-proj")
      assert is_binary(project.id)
      assert project.name == "test-proj"
    end

    test "returns {:error, :already_exists} for duplicate name" do
      {:ok, _project} = ProjectManager.create_project("dup-proj")
      assert {:error, :already_exists} = ProjectManager.create_project("dup-proj")
    end

    test "broadcasts {:project_created, project} via PubSub" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      {:ok, project} = ProjectManager.create_project("broadcast-proj")

      assert_receive {:project_created, ^project}
    end

    test "rejects project name with uppercase letters" do
      assert {:error, :invalid_name} = ProjectManager.create_project("MyProject")
    end

    test "rejects project name with spaces" do
      assert {:error, :invalid_name} = ProjectManager.create_project("my project")
    end

    test "rejects project name with leading dash" do
      assert {:error, :invalid_name} = ProjectManager.create_project("-invalid")
    end

    test "rejects project name with trailing dash" do
      assert {:error, :invalid_name} = ProjectManager.create_project("invalid-")
    end

    test "rejects project name with underscores" do
      assert {:error, :invalid_name} = ProjectManager.create_project("my_project")
    end

    test "rejects empty project name" do
      assert {:error, :invalid_name} = ProjectManager.create_project("")
    end
  end

  describe "destroy_project/1" do
    test "removes a project from the list" do
      {:ok, project} = ProjectManager.create_project("destroy-me")
      wait_for_coordinator(project.id)
      assert :ok = ProjectManager.destroy_project(project.id)
      assert ProjectManager.list_projects() == []
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} =
               ProjectManager.destroy_project("00000000-0000-0000-0000-000000000000")
    end

    test "broadcasts {:project_destroyed, project_id} via PubSub" do
      {:ok, project} = ProjectManager.create_project("destroy-broadcast")
      wait_for_coordinator(project.id)

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      :ok = ProjectManager.destroy_project(project.id)

      project_id = project.id
      assert_receive {:project_destroyed, ^project_id}
    end
  end

  describe "lookup_coordinator/1" do
    test "returns {:ok, pid} for existing project" do
      {:ok, project} = ProjectManager.create_project("lookup-proj")
      Process.sleep(50)

      assert {:ok, pid} = ProjectManager.lookup_coordinator(project.id)
      assert is_pid(pid)
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} =
               ProjectManager.lookup_coordinator("00000000-0000-0000-0000-000000000000")
    end
  end

  describe "lookup_vm/1" do
    test "returns {:error, :not_found} when VM child is not started (test mode)" do
      {:ok, _project} = ProjectManager.create_project("vm-proj")
      Process.sleep(50)

      # In test mode, VirtualMachineMock doesn't implement child_spec,
      # so no VM GenServer is started in the supervision tree.
      assert {:error, :not_found} = ProjectManager.lookup_vm("vm-proj-id")
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} =
               ProjectManager.lookup_vm("00000000-0000-0000-0000-000000000000")
    end
  end

  describe "supervisor monitoring" do
    test "marks project as stopped when supervisor goes down" do
      {:ok, project} = ProjectManager.create_project("monitor-proj")

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      # Terminate the supervisor cleanly (avoids DynamicSupervisor restart race)
      kill_project_supervisor(project.id)

      project_id = project.id
      assert_receive {:project_status_changed, ^project_id}, 1000

      # DB record still exists but status is :stopped (no running supervisor)
      projects = ProjectManager.list_projects()
      assert length(projects) == 1
      assert hd(projects).status == :stopped
    end
  end

  describe "restart_project/1" do
    test "restarts a stopped project" do
      {:ok, project} = ProjectManager.create_project("restart-proj")
      kill_project_supervisor(project.id)

      # Verify it's stopped
      projects = ProjectManager.list_projects()
      assert hd(projects).status == :stopped

      # Restart it
      assert :ok = ProjectManager.restart_project(project.id)

      # Verify it's running again
      projects = ProjectManager.list_projects()
      assert hd(projects).status == :running
    end

    test "returns {:error, :already_running} for a running project" do
      {:ok, project} = ProjectManager.create_project("running-proj")
      assert {:error, :already_running} = ProjectManager.restart_project(project.id)
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} =
               ProjectManager.restart_project("00000000-0000-0000-0000-000000000000")
    end

    test "broadcasts {:project_restarted, project_id} via PubSub" do
      {:ok, project} = ProjectManager.create_project("restart-broadcast")
      kill_project_supervisor(project.id)

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      :ok = ProjectManager.restart_project(project.id)

      project_id = project.id
      assert_receive {:project_restarted, ^project_id}
    end
  end

  describe "list_projects/0 reflects VM status" do
    test "returns :idle status when VM reports idle" do
      {:ok, _project} = ProjectManager.create_project("idle-proj")

      # Override vm_status to return :idle
      Mox.stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :idle end)

      projects = ProjectManager.list_projects()
      assert hd(projects).status == :idle
    end

    test "returns :unreachable status when VM reports unreachable" do
      {:ok, _project} = ProjectManager.create_project("unreach-proj")

      Mox.stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :unreachable end)

      projects = ProjectManager.list_projects()
      assert hd(projects).status == :unreachable
    end

    test "returns :starting status when VM reports starting" do
      {:ok, _project} = ProjectManager.create_project("starting-proj")

      Mox.stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :starting end)

      projects = ProjectManager.list_projects()
      assert hd(projects).status == :starting
    end
  end

  describe "list_projects/0 is non-blocking" do
    test "returns results even when GenServer is processing a slow call" do
      {:ok, _project} = ProjectManager.create_project("nonblock-proj")

      # Suspend the GenServer to simulate it being busy
      :sys.suspend(ProjectManager)

      # list_projects should still work because it bypasses the GenServer
      projects = ProjectManager.list_projects()
      assert length(projects) == 1
      assert hd(projects).name == "nonblock-proj"
      assert hd(projects).status == :running

      :sys.resume(ProjectManager)
    end
  end

  describe "async discovery" do
    test "project_started message registers the project supervisor" do
      # Create a project directly in the DB without going through ProjectManager
      {:ok, project} = Shire.Projects.create_project("async-disc")

      # Start the subtree manually and send the message as handle_continue would
      {:ok, sup_pid} =
        DynamicSupervisor.start_child(
          Shire.ProjectSupervisor,
          {Shire.ProjectInstanceSupervisor, project_id: project.id}
        )

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      send(ProjectManager, {:project_started, project.id, sup_pid})

      project_id = project.id
      assert_receive {:project_status_changed, ^project_id}, 1000

      # Verify the project is tracked in GenServer state
      state = :sys.get_state(ProjectManager)
      assert Map.has_key?(state.projects, project.id)
      assert state.projects[project.id] == sup_pid
    end
  end

  # Waits for the Coordinator's handle_continue to finish so it doesn't
  # hold a DB connection when we terminate the subtree.
  defp wait_for_coordinator(project_id, retries \\ 10) do
    case Registry.lookup(Shire.ProjectRegistry, {:coordinator, project_id}) do
      [{pid, _}] ->
        :sys.get_state(pid, 5_000)
        :ok

      [] when retries > 0 ->
        Process.sleep(10)
        wait_for_coordinator(project_id, retries - 1)

      [] ->
        :ok
    end
  catch
    :exit, _ -> :ok
  end

  # Terminates the project supervisor cleanly and waits for registry cleanup
  defp kill_project_supervisor(project_id) do
    wait_for_coordinator(project_id)

    projects_state = :sys.get_state(ProjectManager)
    sup_pid = Map.get(projects_state.projects, project_id)

    # Use terminate_child for clean shutdown (unregisters from Registry)
    DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, sup_pid)

    # Wait for the DOWN message to be processed by ProjectManager
    Process.sleep(100)
  end
end
