defmodule ShireWeb.ProjectDetailsLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    {:ok, project} = Shire.Projects.create_project("test-project-details")
    project_id = project.id

    start_supervised!(
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
       strategy: :one_for_one},
      id: :agent_sup
    )

    start_supervised!({Shire.Agent.Coordinator, project_id: project_id})
    Process.sleep(50)

    %{project_id: project_id, project_name: "test-project-details"}
  end

  describe "Index" do
    test "renders project details page", %{conn: conn, project_name: project_name} do
      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}/details")
      assert html =~ "ProjectDetailsPage"
    end

    test "saves project document", %{conn: conn, project_name: project_name} do
      expect(Shire.VirtualMachineMock, :write, fn _project,
                                                  "/workspace/PROJECT.md",
                                                  "# Updated content" ->
        :ok
      end)

      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/details")

      view
      |> render_hook("save-project-doc", %{"content" => "# Updated content"})

      assert render(view) =~ "Project document saved"
    end

    test "renames project and redirects", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/details")

      assert {:error, {:redirect, %{to: "/projects/renamed-project/details"}}} =
               view |> render_hook("rename-project", %{"name" => "renamed-project"})
    end

    test "shows error when save-project-doc fails", %{conn: conn, project_name: project_name} do
      expect(Shire.VirtualMachineMock, :write, fn _project,
                                                  "/workspace/PROJECT.md",
                                                  "bad content" ->
        {:error, :write_failed}
      end)

      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/details")

      view
      |> render_hook("save-project-doc", %{"content" => "bad content"})

      assert render(view) =~ "Failed to save"
    end

    test "rejects invalid project name", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/details")

      view
      |> render_hook("rename-project", %{"name" => "INVALID NAME!"})

      assert render(view) =~ "Invalid name"
    end
  end
end
