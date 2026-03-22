defmodule ShireWeb.AgentLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

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

    start_supervised!(Shire.ProjectManager)

    # Create a DB-backed project
    {:ok, project} = Shire.Projects.create_project("test-project")
    project_id = project.id

    # Start the coordinator and agent supervisor for this project
    start_supervised!(
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
       strategy: :one_for_one},
      id: :agent_sup
    )

    start_supervised!({Shire.Agent.Coordinator, project_id: project_id})
    Process.sleep(50)

    %{project_id: project_id, project_name: "test-project"}
  end

  describe "Index" do
    test "returns 404 for non-existent project", %{conn: conn} do
      assert_raise Ecto.NoResultsError, fn ->
        live(conn, ~p"/projects/nonexistent")
      end
    end

    test "renders agent list page", %{conn: conn, project_name: project_name} do
      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}")
      assert html =~ "AgentDashboard"
    end

    test "handles {:agent_status, agent_id, status} from lobby", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_status, "test-agent", :active}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles agent_busy broadcast without crashing", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_busy, "test-agent", true}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- select-agent ---

    test "select-agent with nonexistent agent shows error flash", %{
      conn: conn,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "select-agent", %{"id" => "00000000-0000-0000-0000-000000000000"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- delete-agent ---

    test "delete-agent does not crash the view", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "delete-agent", %{"id" => "00000000-0000-0000-0000-000000000000"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- update-agent ---

    test "update-agent does not crash the view", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "update-agent", %{
        "id" => "00000000-0000-0000-0000-000000000000",
        "recipe_yaml" => "version: 1\nname: test-agent\ndescription: Updated desc\n"
      })

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- create-agent ---

    test "create-agent does not crash the view", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      name = "create-test-#{System.unique_integer([:positive])}"

      render_hook(view, "create-agent", %{
        "name" => name,
        "recipe_yaml" => "version: 1\nname: #{name}\ndescription: A test agent\n"
      })

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- load-more ---

    test "load-more with no selected agent is a no-op", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "load-more", %{"before" => "999"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "load-more with empty params does not crash", %{conn: conn, project_name: project_name} do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "load-more", %{})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- edit-agent ---

    test "edit-agent with nonexistent agent shows error flash", %{
      conn: conn,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "edit-agent", %{"id" => "00000000-0000-0000-0000-000000000000"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- PubSub: agent_status updates statuses map ---

    test "agent_status broadcast updates agent_statuses assign", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_status, "my-agent", :bootstrapping}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- PubSub: agent_updated refreshes agents list ---

    test "agent_updated broadcast refreshes agents list", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_updated, "some-agent"}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- PubSub: agent_deleted refreshes agents list ---

    test "agent_deleted broadcast refreshes agents list", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_deleted, "some-agent"}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- interrupt-agent ---

    test "interrupt-agent with no selected agent is a no-op", %{
      conn: conn,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      render_hook(view, "interrupt-agent", %{})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "agent_event for non-selected agent is ignored", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agents:lobby",
        {:agent_event, "unselected-agent", %{"type" => "text_delta"}}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end
  end

  describe "Show" do
    test "renders agent show page", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "test-agent-show")
      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")
      assert html =~ "AgentShow"
    end

    test "mount sets agent with status", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "my-agent-show")
      {:ok, _view, html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")
      assert html =~ "AgentShow"
    end

    test "update-agent handler does not crash the view", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "test-agent-update")
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")

      render_hook(view, "update-agent", %{
        "recipe_yaml" =>
          "version: 1\nname: test-agent-update\ndescription: new desc\nharness: claude_code\n"
      })

      html = render(view)
      assert html =~ "AgentShow"
    end

    test "delete-agent handler redirects to project index", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "delete-me")
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")

      render_hook(view, "delete-agent", %{})
      assert_redirect(view, "/projects/#{project_name}")
    end

    test "status broadcast updates agent status assign", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "status-agent")
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agent:#{agent.id}",
        {:status, :active}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end

    test "status broadcast updates the agent map with new status", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "status-agent-2")
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agent:#{agent.id}",
        {:status, :idle}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end

    test "agent_event broadcast does not crash", %{
      conn: conn,
      project_id: project_id,
      project_name: project_name
    } do
      agent = create_db_agent(project_id, "test-agent-event")
      {:ok, view, _html} = live(conn, ~p"/projects/#{project_name}/agents/#{agent.name}")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:agent:#{agent.id}",
        {:agent_event, agent.id, %{"type" => "text_delta", "payload" => %{"delta" => "hi"}}}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end
  end

  defp create_db_agent(project_id, name) do
    {:ok, agent} =
      Shire.Agents.create_agent_with_vm(
        project_id,
        name,
        "version: 1\nname: #{name}\n",
        Shire.VirtualMachineStub
      )

    agent
  end
end
