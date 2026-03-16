defmodule SpriteAgentsWeb.AgentLive.Show do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent = Agents.get_agent!(id)
    {:ok, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agent: #{socket.assigns.agent.name}")}
  end

  @impl true
  def handle_event("edit", %{"id" => id}, socket) do
    {:noreply, push_navigate(socket, to: ~p"/agents/#{id}/edit")}
  end

  defp serialize_agent(agent) do
    agent
    |> Map.from_struct()
    |> Map.drop([:__meta__, :secrets])
    |> Map.update(:inserted_at, nil, &to_string/1)
    |> Map.update(:updated_at, nil, &to_string/1)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react name="AgentShow" agent={serialize_agent(@agent)} socket={@socket} />
    """
  end
end
