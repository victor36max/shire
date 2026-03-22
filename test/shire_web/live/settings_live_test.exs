defmodule ShireWeb.SettingsLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  alias Shire.Agents

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
    stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
    stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
    stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)
    stub(Shire.VirtualMachineMock, :ls, fn _project, _path -> {:ok, []} end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    # Create a DB-backed project
    {:ok, project} = Shire.Projects.create_project("test-project-settings")
    project_id = project.id

    start_supervised!(
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
       strategy: :one_for_one},
      id: :agent_sup
    )

    start_supervised!({Shire.Agent.Coordinator, project_id: project_id})
    Process.sleep(50)

    %{project_id: project_id, project_name: "test-project-settings"}
  end

  describe "Index" do
    test "renders settings page", %{conn: conn, project_name: project_name} do
      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}/settings")
      assert html =~ "SettingsPage"
    end

    test "loads inter-agent messages", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, agent} =
        Agents.create_agent_with_vm(
          project_id,
          "test-agent",
          "version: 1\n",
          Shire.VirtualMachineStub
        )

      {:ok, _msg} =
        Agents.create_message(%{
          project_id: project_id,
          agent_id: agent.id,
          role: "inter_agent",
          content: %{
            "text" => "Hello from Alice",
            "from_agent" => "Alice",
            "to_agent" => "test-agent"
          }
        })

      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}/settings")
      assert html =~ "Hello from Alice"
      assert html =~ "Alice"
    end
  end
end
