defmodule ShireWeb.ProjectLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    stub(Shire.VirtualMachineMock, :list_vms, fn -> {:ok, []} end)
    stub(Shire.VirtualMachineMock, :destroy_vm, fn _name -> :ok end)

    start_supervised!(Shire.ProjectManager)

    on_exit(fn ->
      for {_, pid, _, _} <- DynamicSupervisor.which_children(Shire.ProjectSupervisor),
          is_pid(pid) do
        DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, pid)
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
      {:ok, _pid} = Shire.ProjectManager.create_project("existing")
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "create-project", %{"name" => "existing"})

      html = render(view)
      assert html =~ "already exists"
    end

    test "delete-project event removes a project", %{conn: conn} do
      {:ok, _pid} = Shire.ProjectManager.create_project("delete-me")
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "delete-project", %{"name" => "delete-me"})

      assert Shire.ProjectManager.list_projects() == []
    end

    test "PubSub project_created message refreshes list", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      {:ok, _pid} = Shire.ProjectManager.create_project("pubsub-proj")

      # The PubSub broadcast from create_project should refresh the LiveView
      html = render(view)
      assert html =~ "ProjectDashboard"
    end

    test "PubSub project_destroyed message refreshes list", %{conn: conn} do
      {:ok, _pid} = Shire.ProjectManager.create_project("destroy-proj")
      {:ok, view, _html} = live(conn, ~p"/")

      :ok = Shire.ProjectManager.destroy_project("destroy-proj")

      html = render(view)
      assert html =~ "ProjectDashboard"
    end
  end
end
