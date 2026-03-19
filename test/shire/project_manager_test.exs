defmodule Shire.ProjectManagerTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.ProjectManager

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    stub(Shire.VirtualMachineMock, :list_vms, fn -> {:ok, []} end)
    stub(Shire.VirtualMachineMock, :destroy_vm, fn _name -> :ok end)

    start_supervised!(ProjectManager)

    on_exit(fn ->
      # Clean up any ProjectInstanceSupervisors started under the app-level DynamicSupervisor
      for {_, pid, _, _} <- DynamicSupervisor.which_children(Shire.ProjectSupervisor),
          is_pid(pid) do
        DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, pid)
      end
    end)

    :ok
  end

  describe "list_projects/0" do
    test "returns empty list when no projects exist" do
      assert ProjectManager.list_projects() == []
    end

    test "returns projects with :running status after creation" do
      {:ok, _pid} = ProjectManager.create_project("my-project")

      projects = ProjectManager.list_projects()
      assert length(projects) == 1
      assert hd(projects).name == "my-project"
      assert hd(projects).status == :running
    end
  end

  describe "create_project/1" do
    test "creates a project and returns {:ok, pid}" do
      assert {:ok, pid} = ProjectManager.create_project("test-proj")
      assert is_pid(pid)
    end

    test "returns {:error, :already_exists} for duplicate name" do
      {:ok, _pid} = ProjectManager.create_project("dup-proj")
      assert {:error, :already_exists} = ProjectManager.create_project("dup-proj")
    end

    test "broadcasts {:project_created, name} via PubSub" do
      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      {:ok, _pid} = ProjectManager.create_project("broadcast-proj")

      assert_receive {:project_created, "broadcast-proj"}
    end
  end

  describe "destroy_project/1" do
    test "removes a project from the list" do
      {:ok, _pid} = ProjectManager.create_project("destroy-me")
      assert :ok = ProjectManager.destroy_project("destroy-me")
      assert ProjectManager.list_projects() == []
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} = ProjectManager.destroy_project("nope")
    end

    test "broadcasts {:project_destroyed, name} via PubSub" do
      {:ok, _pid} = ProjectManager.create_project("destroy-broadcast")

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      :ok = ProjectManager.destroy_project("destroy-broadcast")

      assert_receive {:project_destroyed, "destroy-broadcast"}
    end
  end

  describe "lookup_coordinator/1" do
    test "returns {:ok, pid} for existing project" do
      {:ok, _pid} = ProjectManager.create_project("lookup-proj")
      Process.sleep(50)

      assert {:ok, pid} = ProjectManager.lookup_coordinator("lookup-proj")
      assert is_pid(pid)
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} = ProjectManager.lookup_coordinator("nope")
    end
  end

  describe "lookup_vm/1" do
    test "returns {:ok, pid} for existing project" do
      {:ok, _pid} = ProjectManager.create_project("vm-proj")
      Process.sleep(50)

      assert {:ok, pid} = ProjectManager.lookup_vm("vm-proj")
      assert is_pid(pid)
    end

    test "returns {:error, :not_found} for non-existent project" do
      assert {:error, :not_found} = ProjectManager.lookup_vm("nope")
    end
  end

  describe "supervisor monitoring" do
    test "removes project when supervisor goes down" do
      {:ok, sup_pid} = ProjectManager.create_project("monitor-proj")

      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")

      # Kill the supervisor
      Process.exit(sup_pid, :kill)

      assert_receive {:project_destroyed, "monitor-proj"}, 1000

      assert ProjectManager.list_projects() == []
    end
  end
end
