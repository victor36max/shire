defmodule ShireWeb.AgentLiveTest do
  use ShireWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias Shire.Agents

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
      assert html =~ "AgentDashboard"
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

    test "tracks busy agents via agent_busy broadcast", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      # Broadcast busy=true
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_busy, agent.id, true}
      )

      html = render(view)
      # HTML-encoded in data-props attribute
      assert html =~ "&quot;busy&quot;:true"

      # Broadcast busy=false
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_busy, agent.id, false}
      )

      html = render(view)
      refute html =~ "&quot;busy&quot;:true"
    end

    test "ignores {:status, _} from agent topic to avoid double processing", %{
      conn: conn,
      agent: agent
    } do
      {:ok, view, _html} = live(conn, ~p"/")

      # Select the agent first
      render_hook(view, "select-agent", %{"id" => agent.id})

      # Send {:status, :active} on the agent-specific topic
      # This should be a no-op since Index uses {:agent_status, ...} from lobby
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:#{agent.id}",
        {:status, :active}
      )

      # Should not crash; view still renders
      html = render(view)
      assert html =~ "AgentDashboard"
    end

    test "handles {:agent_status, agent_id, status} from lobby", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      # Select the agent
      render_hook(view, "select-agent", %{"id" => agent.id})

      # Broadcast status via lobby (the correct path)
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, agent.id, :active}
      )

      html = render(view)
      assert html =~ "&quot;status&quot;:&quot;active&quot;"
    end

    test "ignores agent events for non-selected agents", %{conn: conn, agent: agent} do
      {:ok, view, _html} = live(conn, ~p"/")

      # Select the agent
      render_hook(view, "select-agent", %{"id" => agent.id})

      # Create a different agent
      {:ok, other_agent} = Agents.create_agent(%{recipe: valid_recipe("Other Agent")})

      # Broadcast an event for the OTHER agent on the selected agent's topic
      # This uses the new 3-tuple format with agent_id
      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:#{agent.id}",
        {:agent_event, other_agent.id,
         %{"type" => "text_delta", "payload" => %{"delta" => "Hello"}}}
      )

      # Should not update streaming text for wrong agent
      html = render(view)
      refute html =~ "agent_streaming"
    end
  end
end
