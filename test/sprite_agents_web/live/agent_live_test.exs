defmodule SpriteAgentsWeb.AgentLiveTest do
  use SpriteAgentsWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias SpriteAgents.Agents

  defp create_agent(_) do
    {:ok, agent} = Agents.create_agent(%{name: "Test Agent", model: "claude-sonnet-4-6"})
    %{agent: agent}
  end

  describe "Index" do
    test "renders agent list page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "AgentPage"
    end

    setup [:create_agent]

    test "displays agents in serialized props", %{conn: conn, agent: agent} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ agent.name
    end

    test "creates a new agent via event", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "create-agent", %{
        "agent" => %{"name" => "New Agent", "model" => "claude-sonnet-4-6"}
      })

      html = render(view)
      assert html =~ "New Agent"
    end

    test "updates an agent via event", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "update-agent", %{
        "id" => agent.id,
        "agent" => %{"name" => "Updated Agent"}
      })

      html = render(view)
      assert html =~ "Updated Agent"
    end

    test "deletes an agent via event", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "delete-agent", %{"id" => agent.id})

      html = render(view)
      refute html =~ "Test Agent"
    end
  end
end
