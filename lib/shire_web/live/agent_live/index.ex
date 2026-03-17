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

    agents = Agents.list_agents()
    agent_ids = Enum.map(agents, & &1.id)
    statuses = Coordinator.agent_statuses(agent_ids)

    {:ok,
     assign(socket,
       agents: agents,
       base_recipes: Agents.list_base_recipes(),
       agent: nil,
       selected_agent_id: nil,
       selected_agent: nil,
       messages: [],
       has_more: false,
       loading_more: false,
       streaming_text: nil,
       busy_agents: MapSet.new(),
       agent_statuses: statuses
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agents")}
  end

  # Agent CRUD events

  @impl true
  def handle_event("delete-agent", %{"id" => id}, socket) do
    agent = Agents.get_agent!(id)
    {:ok, _} = Agents.delete_agent(agent)

    socket =
      if socket.assigns.selected_agent_id == id do
        # Deselect if the deleted agent was selected
        if socket.assigns.selected_agent_id do
          Phoenix.PubSub.unsubscribe(Shire.PubSub, "agent:#{id}")
        end

        assign(socket,
          selected_agent_id: nil,
          selected_agent: nil,
          messages: [],
          has_more: false,
          streaming_text: nil
        )
      else
        socket
      end

    agents = Agents.list_agents()
    statuses = Map.delete(socket.assigns.agent_statuses, id)
    {:noreply, assign(socket, agents: agents, agent_statuses: statuses)}
  end

  def handle_event("edit-agent", %{"id" => id}, socket) do
    {:noreply, assign(socket, :agent, Agents.get_agent!(id))}
  end

  def handle_event("create-agent", %{"recipe" => recipe}, socket) do
    case Agents.create_agent(%{recipe: recipe}) do
      {:ok, _agent} ->
        agents = Agents.list_agents()
        agent_ids = Enum.map(agents, & &1.id)
        statuses = Coordinator.agent_statuses(agent_ids)

        {:noreply,
         socket
         |> put_flash(:info, "Agent created successfully")
         |> assign(agents: agents, agent_statuses: statuses)}

      {:error, changeset} ->
        error_msg = format_errors(changeset)
        {:noreply, put_flash(socket, :error, error_msg)}
    end
  end

  def handle_event("update-agent", %{"id" => id, "recipe" => recipe}, socket) do
    agent = Agents.get_agent!(id)

    case Agents.update_agent(agent, %{recipe: recipe}) do
      {:ok, _agent} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent updated successfully")
         |> assign(:agents, Agents.list_agents())}

      {:error, changeset} ->
        error_msg = format_errors(changeset)
        {:noreply, put_flash(socket, :error, error_msg)}
    end
  end

  # Agent selection and chat events

  @impl true
  def handle_event("select-agent", %{"id" => id}, socket) do
    old_id = socket.assigns.selected_agent_id

    if old_id do
      Phoenix.PubSub.unsubscribe(Shire.PubSub, "agent:#{old_id}")
    end

    agent = Agents.get_agent!(id)

    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{agent.id}")
    end

    {messages, has_more} = Agents.list_messages_for_agent(agent.id, limit: 50)

    status = Coordinator.agent_status(agent.id)
    statuses = Map.put(socket.assigns.agent_statuses, agent.id, status)

    {:noreply,
     assign(socket,
       selected_agent_id: agent.id,
       selected_agent: Helpers.serialize_agent(agent, socket.assigns.busy_agents, statuses),
       agent_statuses: statuses,
       messages: Enum.map(messages, &Helpers.serialize_message/1),
       has_more: has_more,
       loading_more: false,
       streaming_text: nil
     )}
  end

  @impl true
  def handle_event("send-message", %{"text" => text}, socket) do
    agent_id = socket.assigns.selected_agent_id

    case Coordinator.send_message(agent_id, text) do
      :ok ->
        {:ok, msg} =
          Agents.create_message(%{agent_id: agent_id, role: "user", content: %{"text" => text}})

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
    if !socket.assigns.has_more || socket.assigns.loading_more do
      {:noreply, socket}
    else
      socket = assign(socket, :loading_more, true)
      messages = socket.assigns.messages
      cursor = if messages != [], do: List.first(messages)[:id]

      {older, has_more} =
        Agents.list_messages_for_agent(socket.assigns.selected_agent_id,
          before: cursor,
          limit: 50
        )

      older_serialized = Enum.map(older, &Helpers.serialize_message/1)

      {:noreply,
       assign(socket,
         messages: older_serialized ++ messages,
         has_more: has_more,
         loading_more: false
       )}
    end
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

  # Status updates from agent-specific topic are ignored in Index —
  # the {:agent_status, agent_id, status} handler from "agents:lobby" covers it,
  # preventing double processing when both topics deliver the same update.
  @impl true
  def handle_info({:status, _status}, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_info({:agent_busy, agent_id, active}, socket) do
    busy_agents =
      if active,
        do: MapSet.put(socket.assigns.busy_agents, agent_id),
        else: MapSet.delete(socket.assigns.busy_agents, agent_id)

    socket = assign(socket, :busy_agents, busy_agents)

    # Update selected agent if it matches
    socket =
      if socket.assigns.selected_agent_id == agent_id do
        case Agents.get_agent(agent_id) do
          {:ok, agent} ->
            assign(
              socket,
              :selected_agent,
              Helpers.serialize_agent(agent, busy_agents, socket.assigns.agent_statuses)
            )

          {:error, :not_found} ->
            socket
        end
      else
        socket
      end

    {:noreply, socket}
  end

  @impl true
  def handle_info({:agent_status, agent_id, status}, socket) do
    statuses = Map.put(socket.assigns.agent_statuses, agent_id, status)
    socket = assign(socket, :agent_statuses, statuses)

    # Also update selected agent if it matches
    socket =
      if socket.assigns.selected_agent_id == agent_id do
        case Agents.get_agent(agent_id) do
          {:ok, agent} ->
            assign(
              socket,
              :selected_agent,
              Helpers.serialize_agent(agent, socket.assigns.busy_agents, statuses)
            )

          {:error, :not_found} ->
            socket
        end
      else
        socket
      end

    {:noreply, socket}
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
    |> Enum.map_join(", ", fn {field, msgs} -> "#{field}: #{Enum.join(msgs, ", ")}" end)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentDashboard"
      agents={Helpers.serialize_agents(@agents, @busy_agents, @agent_statuses)}
      selectedAgent={@selected_agent}
      messages={@messages}
      hasMore={@has_more}
      loadingMore={@loading_more}
      editAgent={Helpers.serialize_agent(@agent, MapSet.new(), @agent_statuses)}
      baseRecipes={Helpers.serialize_base_recipes(@base_recipes)}
      socket={@socket}
    />
    """
  end
end
