defmodule ShireWeb.ProjectLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :cmd!, fn _project, _cmd, _args, _opts -> "" end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
    stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
    stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
    stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    stub(Shire.VirtualMachineMock, :destroy_vm, fn _name -> :ok end)
    stub(Shire.VirtualMachineMock, :touch_keepalive, fn _project_id -> :ok end)
    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

    pid = start_supervised!({Shire.ProjectManager, []}, restart: :temporary)
    Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

    on_exit(fn ->
      try do
        for {_, child_pid, _, _} <- DynamicSupervisor.which_children(Shire.ProjectSupervisor),
            is_pid(child_pid) do
          DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, child_pid)
        end
      catch
        :exit, _ -> :ok
      end
    end)

    :ok
  end

  describe "Index" do
    test "renders project dashboard page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "ProjectDashboard"
    end

    test "create-project event creates a project", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "create-project", %{"name" => "new-proj"})

      projects = Shire.ProjectManager.list_projects()
      assert length(projects) == 1
      assert hd(projects).name == "new-proj"
    end

    test "create-project with duplicate name shows error", %{conn: conn} do
      {:ok, _project} = Shire.ProjectManager.create_project("existing")
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "create-project", %{"name" => "existing"})

      html = render(view)
      assert html =~ "already exists"
    end

    test "delete-project event removes a project", %{conn: conn} do
      {:ok, project} = Shire.ProjectManager.create_project("delete-me")
      # Wait for the Coordinator's handle_continue to complete so it doesn't
      # hold a DB connection when we terminate the subtree.
      wait_for_coordinator(project.id)
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "delete-project", %{"id" => project.id})

      assert Shire.ProjectManager.list_projects() == []
    end

    test "PubSub project_created message refreshes list", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      {:ok, _project} = Shire.ProjectManager.create_project("pubsub-proj")

      html = render(view)
      assert html =~ "ProjectDashboard"
    end

    test "PubSub project_destroyed message refreshes list", %{conn: conn} do
      {:ok, project} = Shire.ProjectManager.create_project("destroy-proj")
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "projects:lobby",
        {:project_destroyed, project.id}
      )

      html = render(view)
      assert html =~ "ProjectDashboard"
    end
  end

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
end
