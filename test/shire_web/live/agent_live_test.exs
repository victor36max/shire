defmodule ShireWeb.AgentLiveTest do
  use ShireWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  describe "Index" do
    test "renders agent list page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "AgentDashboard"
    end

    test "handles {:status, _} from agent topic without crashing", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      # Send {:status, :active} on an agent-specific topic
      # This should be a no-op since Index uses {:agent_status, ...} from lobby
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:some-id",
        {:status, :active}
      )

      # Should not crash; view still renders
      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles {:agent_status, agent_id, status} from lobby", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      # Broadcast status via lobby
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, 123, :active}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles agent_busy broadcast without crashing", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_busy, 123, true}
      )

      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "stubbed CRUD events do not crash", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      # These are all stubbed as no-ops now
      render_hook(view, "create-agent", %{"recipe" => "name: test"})
      render_hook(view, "update-agent", %{"id" => 1, "recipe" => "name: test"})
      render_hook(view, "delete-agent", %{"id" => 1})

      html = render(view)
      assert html =~ "AgentDashboard"
    end
  end
end
