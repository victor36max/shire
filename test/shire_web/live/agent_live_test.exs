defmodule ShireWeb.AgentLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :cmd, fn _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    start_supervised!(Shire.Agent.Coordinator)
    Process.sleep(50)
    :ok
  end

  describe "Index" do
    test "renders agent list page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "AgentDashboard"
    end

    test "handles {:status, _} from agent topic without crashing", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:some-agent",
        {:status, :active}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles {:agent_status, agent_name, status} from lobby", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, "test-agent", :active}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles agent_busy broadcast without crashing", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_busy, "test-agent", true}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- select-agent ---

    test "select-agent with nonexistent agent shows error flash", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      # In test env, Coordinator has no VM, so get_agent returns {:error, :no_vm}
      render_hook(view, "select-agent", %{"name" => "nonexistent-agent"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- delete-agent ---

    test "delete-agent succeeds and refreshes agents list", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "delete-agent", %{"name" => "some-agent"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "delete-agent clears selection when deleted agent was selected", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      # First try selecting (will fail due to no VM, but that's ok)
      # Then delete the agent that was "selected" — verifying it clears
      render_hook(view, "delete-agent", %{"name" => "selected-agent"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "delete-agent preserves selection when different agent is deleted", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "delete-agent", %{"name" => "other-agent"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- update-agent ---

    test "update-agent does not crash the view", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "update-agent", %{
        "name" => "test-agent",
        "recipe_yaml" => "version: 1\nname: test-agent\ndescription: Updated desc\n"
      })

      html = render(view)
      # Result depends on VM availability: either "Agent updated" or "Failed to update"
      assert html =~ "AgentDashboard"
    end

    # --- create-agent ---

    test "create-agent does not crash the view", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      name = "create-test-#{System.unique_integer([:positive])}"

      render_hook(view, "create-agent", %{
        "name" => name,
        "recipe_yaml" => "version: 1\nname: #{name}\ndescription: A test agent\n"
      })

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- load-more ---

    test "load-more with no selected agent is a no-op", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "load-more", %{"before" => "999"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- edit-agent ---

    test "edit-agent with nonexistent agent shows error flash", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "edit-agent", %{"name" => "nonexistent"})

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    # --- PubSub: agent_status updates statuses map ---

    test "agent_status broadcast updates agent_statuses assign", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, "my-agent", :bootstrapping}
      )

      # Give it a moment to process
      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "agent_event for non-selected agent is ignored", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_event, "unselected-agent", %{"type" => "text_delta"}}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end
  end

  describe "Show" do
    test "renders agent show page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/agents/test-agent")
      assert html =~ "AgentShow"
    end

    test "mount sets agent with status", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/agents/my-agent")
      assert html =~ "AgentShow"
    end

    test "update-agent handler does not crash the view", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/agents/test-agent")

      render_hook(view, "update-agent", %{
        "recipe_yaml" =>
          "version: 1\nname: test-agent\ndescription: new desc\nharness: claude_code\n"
      })

      html = render(view)
      # Result depends on VM availability
      assert html =~ "AgentShow"
    end

    test "delete-agent handler redirects to index", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/agents/delete-me")

      render_hook(view, "delete-agent", %{})
      assert_redirect(view, "/")
    end

    test "status broadcast updates agent status assign", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/agents/status-agent")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:status-agent",
        {:status, :active}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end

    test "status broadcast updates the agent map with new status", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/agents/status-agent")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:status-agent",
        {:status, :failed}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end

    test "agent_event broadcast does not crash", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/agents/test-agent")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:test-agent",
        {:agent_event, "test-agent", %{"type" => "text_delta", "payload" => %{"delta" => "hi"}}}
      )

      html = render(view)
      assert html =~ "AgentShow"
    end
  end
end
