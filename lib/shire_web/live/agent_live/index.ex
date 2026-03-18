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

    agents = Coordinator.list_agents()

    {:ok,
     assign(socket,
       agents: agents,
       selected_agent_name: nil,
       selected_agent: nil,
       messages: [],
       has_more: false,
       loading_more: false,
       streaming_text: nil,
       busy_agents: MapSet.new(),
       agent_statuses: %{},
       editing_agent: nil
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agents")}
  end

  # Agent CRUD events

  @impl true
  def handle_event("delete-agent", %{"name" => name}, socket) do
    case Coordinator.delete_agent(name) do
      :ok ->
        agents = Coordinator.list_agents()

        selected =
          if socket.assigns.selected_agent_name == name do
            nil
          else
            socket.assigns.selected_agent_name
          end

        {:noreply,
         assign(socket,
           agents: agents,
           selected_agent_name: selected,
           selected_agent: if(selected, do: socket.assigns.selected_agent, else: nil),
           messages: if(selected, do: socket.assigns.messages, else: [])
         )}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  def handle_event("edit-agent", %{"name" => name}, socket) do
    case Coordinator.get_agent(name) do
      {:ok, agent} ->
        {:noreply, assign(socket, :editing_agent, agent)}

      {:error, _} ->
        {:noreply, put_flash(socket, :error, "Agent not found")}
    end
  end

  def handle_event("create-agent", params, socket) do
    case Coordinator.create_agent(params) do
      {:ok, _pid} ->
        agents = Coordinator.list_agents()

        {:noreply,
         socket
         |> assign(:agents, agents)
         |> assign(:editing_agent, nil)
         |> put_flash(:info, "Agent created")}

      {:error, :already_exists} ->
        {:noreply, put_flash(socket, :error, "Agent already exists")}

      {:error, :no_vm} ->
        {:noreply, put_flash(socket, :error, "No VM available")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to create agent: #{inspect(reason)}")}
    end
  end

  def handle_event("update-agent", params, socket) do
    name = params["name"]

    case Coordinator.update_agent(name, params) do
      :ok ->
        agents = Coordinator.list_agents()

        selected_agent =
          if socket.assigns.selected_agent_name == name do
            case Coordinator.get_agent(name) do
              {:ok, agent} -> agent
              _ -> socket.assigns.selected_agent
            end
          else
            socket.assigns.selected_agent
          end

        {:noreply,
         socket
         |> assign(:agents, agents)
         |> assign(:selected_agent, selected_agent)
         |> assign(:editing_agent, nil)
         |> put_flash(:info, "Agent updated")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to update: #{inspect(reason)}")}
    end
  end

  # Agent selection and chat events

  @impl true
  def handle_event("select-agent", %{"name" => name}, socket) do
    case Coordinator.get_agent(name) do
      {:ok, agent} ->
        if connected?(socket) do
          # Unsubscribe from previous agent if any
          if old = socket.assigns.selected_agent_name do
            Phoenix.PubSub.unsubscribe(Shire.PubSub, "agent:#{old}")
          end

          Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{name}")
        end

        {messages, has_more} = Agents.list_messages_for_agent(name, limit: 50)

        {:noreply,
         assign(socket,
           selected_agent_name: name,
           selected_agent: agent,
           messages: Enum.map(messages, &Helpers.serialize_message/1),
           has_more: has_more,
           streaming_text: nil
         )}

      {:error, _} ->
        {:noreply, put_flash(socket, :error, "Agent not found")}
    end
  end

  @impl true
  def handle_event("send-message", %{"text" => text}, socket) do
    agent_name = socket.assigns.selected_agent_name

    case Coordinator.send_message(agent_name, text) do
      {:ok, msg} ->
        messages = socket.assigns.messages ++ [Helpers.serialize_message(msg)]
        {:noreply, assign(socket, :messages, messages)}

      :ok ->
        # Message delivered but persistence failed (logged in AgentManager)
        {:noreply, socket}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to send: #{inspect(reason)}")}
    end
  catch
    :exit, _ ->
      {:noreply, put_flash(socket, :error, "Agent is not running. Start it first.")}
  end

  @impl true
  def handle_event("load-more", %{"before" => before}, socket) do
    name = socket.assigns.selected_agent_name

    if name do
      {new_messages, has_more} = Agents.list_messages_for_agent(name, before: before, limit: 50)

      all_messages =
        Enum.map(new_messages, &Helpers.serialize_message/1) ++ socket.assigns.messages

      {:noreply,
       assign(socket,
         messages: all_messages,
         has_more: has_more,
         loading_more: false
       )}
    else
      {:noreply, socket}
    end
  end

  # PubSub handlers

  @impl true
  def handle_info({:agent_event, agent_name, event}, socket) do
    if socket.assigns.selected_agent_name == agent_name do
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
  def handle_info({:agent_busy, agent_name, active}, socket) do
    busy_agents =
      if active do
        MapSet.put(socket.assigns.busy_agents, agent_name)
      else
        MapSet.delete(socket.assigns.busy_agents, agent_name)
      end

    # Update selected agent's busy state if it's the one that changed
    selected_agent =
      if socket.assigns.selected_agent && socket.assigns.selected_agent_name == agent_name do
        Map.put(socket.assigns.selected_agent, :busy, active)
      else
        socket.assigns.selected_agent
      end

    {:noreply,
     assign(socket,
       busy_agents: busy_agents,
       selected_agent: selected_agent
     )}
  end

  @impl true
  def handle_info({:agent_created, _name}, socket) do
    agents = Coordinator.list_agents()
    {:noreply, assign(socket, :agents, agents)}
  end

  @impl true
  def handle_info({:agent_status, agent_name, status}, socket) do
    statuses = Map.put(socket.assigns.agent_statuses, agent_name, status)
    {:noreply, assign(socket, :agent_statuses, statuses)}
  end

  @impl true
  def render(assigns) do
    agents_with_busy =
      Enum.map(assigns.agents, fn agent ->
        Map.put(agent, :busy, MapSet.member?(assigns.busy_agents, agent.name))
      end)

    assigns = assign(assigns, :agents_with_busy, agents_with_busy)

    ~H"""
    <.react
      name="AgentDashboard"
      agents={@agents_with_busy}
      selectedAgent={@selected_agent}
      editAgent={@editing_agent}
      messages={@messages}
      hasMore={@has_more}
      loadingMore={@loading_more}
      socket={@socket}
    />
    """
  end
end
