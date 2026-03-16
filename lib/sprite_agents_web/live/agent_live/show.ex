defmodule SpriteAgentsWeb.AgentLive.Show do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent = Agents.get_agent!(id)

    if connected?(socket) do
      Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "agent:#{agent.name}")
    end

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

  @impl true
  def handle_event("start-agent", _params, socket) do
    agent = socket.assigns.agent

    case SpriteAgents.Agent.Coordinator.start_agent(agent.name) do
      {:ok, _pid} ->
        agent = Agents.get_agent!(agent.id)

        {:noreply,
         socket
         |> assign(:agent, agent)
         |> put_flash(:info, "Agent starting...")}

      {:error, :already_running} ->
        {:noreply, put_flash(socket, :error, "Agent is already running")}

      {:error, :no_sprites_token} ->
        {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to start agent: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("stop-agent", _params, socket) do
    agent = socket.assigns.agent

    case SpriteAgents.Agent.Coordinator.stop_agent(agent.name) do
      :ok ->
        agent = Agents.get_agent!(agent.id)

        {:noreply,
         socket
         |> assign(:agent, agent)
         |> put_flash(:info, "Agent stopped")}

      {:error, :not_found} ->
        {:noreply, put_flash(socket, :error, "Agent is not running")}
    end
  end

  @impl true
  def handle_info({:status, _status}, socket) do
    agent = Agents.get_agent!(socket.assigns.agent.id)
    {:noreply, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_info({:agent_event, _event}, socket) do
    # For now, ignore agent events on the show page (chat page will use these)
    {:noreply, socket}
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
