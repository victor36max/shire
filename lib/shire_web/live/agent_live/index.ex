defmodule ShireWeb.AgentLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Agent.Coordinator
  alias ShireWeb.AgentLive.{AgentStreaming, Helpers}

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agents:lobby")
    end

    {:ok,
     assign(socket,
       agents: [],
       agent: nil,
       selected_agent_id: nil,
       selected_agent: nil,
       messages: [],
       has_more: false,
       loading_more: false,
       streaming_text: nil,
       busy_agents: MapSet.new(),
       agent_statuses: %{}
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agents")}
  end

  # Agent CRUD events — stubbed out, will be rewritten in Phase 4

  @impl true
  def handle_event("delete-agent", _params, socket) do
    {:noreply, socket}
  end

  def handle_event("edit-agent", _params, socket) do
    {:noreply, socket}
  end

  def handle_event("create-agent", _params, socket) do
    {:noreply, socket}
  end

  def handle_event("update-agent", _params, socket) do
    {:noreply, socket}
  end

  # Agent selection and chat events

  @impl true
  def handle_event("select-agent", _params, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("send-message", %{"text" => text}, socket) do
    agent_id = socket.assigns.selected_agent_id

    case Coordinator.send_message(agent_id, text) do
      :ok ->
        {:ok, msg} =
          Agents.create_message(%{
            agent_name: "placeholder",
            role: "user",
            content: %{"text" => text}
          })

        messages = socket.assigns.messages ++ [Helpers.serialize_message(msg)]
        {:noreply, assign(socket, :messages, messages)}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to send: #{inspect(reason)}")}
    end
  catch
    :exit, _ ->
      {:noreply, put_flash(socket, :error, "Agent is not running. Start it first.")}
  end

  @impl true
  def handle_event("load-more", _params, socket) do
    {:noreply, socket}
  end

  # PubSub handlers

  @impl true
  def handle_info({:agent_event, agent_id, event}, socket) do
    if socket.assigns.selected_agent_id == agent_id do
      {:noreply, AgentStreaming.process_agent_event(socket, event)}
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_info({:status, _status}, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_info({:agent_busy, _agent_id, _active}, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_info({:agent_status, agent_id, status}, socket) do
    statuses = Map.put(socket.assigns.agent_statuses, agent_id, status)
    {:noreply, assign(socket, :agent_statuses, statuses)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentDashboard"
      agents={@agents}
      selectedAgent={@selected_agent}
      messages={@messages}
      hasMore={@has_more}
      loadingMore={@loading_more}
      editAgent={nil}
      baseRecipes={[]}
      socket={@socket}
    />
    """
  end
end
