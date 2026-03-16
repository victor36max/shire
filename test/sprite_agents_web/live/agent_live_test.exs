defmodule SpriteAgentsWeb.AgentLiveTest do
  use SpriteAgentsWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias SpriteAgents.Agents

  defp valid_recipe(name) do
    """
    version: 1
    name: #{name}
    harness: pi
    model: claude-sonnet-4-6
    system_prompt: You are a test agent.
    """
  end

  defp create_agent(_) do
    {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe("Test Agent")})
    %{agent: agent}
  end

  describe "Index" do
    test "renders agent list page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "AgentPage"
    end

    setup [:create_agent]

    test "displays agents in serialized props", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/")
      assert html =~ "Test Agent"
    end

    test "creates a new agent via event", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "create-agent", %{
        "recipe" => valid_recipe("New Agent")
      })

      html = render(view)
      assert html =~ "New Agent"
    end

    test "updates an agent via event", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      render_hook(view, "update-agent", %{
        "id" => agent.id,
        "recipe" => valid_recipe("Updated Agent")
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
