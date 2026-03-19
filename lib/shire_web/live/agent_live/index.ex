defmodule ShireWeb.AgentLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Agent.Coordinator
  alias Shire.ProjectManager
  alias ShireWeb.AgentLive.{AgentStreaming, Helpers}

  @impl true
  def mount(%{"project" => project}, _session, socket) do
    case ProjectManager.lookup_coordinator(project) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        if connected?(socket) do
          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project}:agents:lobby")
        end

        agents = Coordinator.list_agents(project)
        projects = ProjectManager.list_projects()

        {:ok,
         assign(socket,
           project: project,
           projects: projects,
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
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agents")}
  end

  # Agent CRUD events

  @impl true
  def handle_event("delete-agent", %{"name" => name}, socket) do
    project = socket.assigns.project

    case Coordinator.delete_agent(project, name) do
      :ok ->
        agents = Coordinator.list_agents(project)

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
    case Coordinator.get_agent(socket.assigns.project, name) do
      {:ok, agent} ->
        {:noreply, assign(socket, :editing_agent, agent)}

      {:error, _} ->
        {:noreply, put_flash(socket, :error, "Agent not found")}
    end
  end

  def handle_event("create-agent", params, socket) do
    project = socket.assigns.project

    case Coordinator.create_agent(project, params) do
      {:ok, _pid} ->
        agents = Coordinator.list_agents(project)

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
    project = socket.assigns.project
    name = params["name"]

    case Coordinator.update_agent(project, name, params) do
      :ok ->
        {:noreply,
         socket
         |> assign(:editing_agent, nil)
         |> put_flash(:info, "Agent updated")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to update: #{inspect(reason)}")}
    end
  end

  # Agent selection and chat events

  @impl true
  def handle_event("select-agent", %{"name" => name}, socket) do
    project = socket.assigns.project

    case Coordinator.get_agent(project, name) do
      {:ok, agent} ->
        if connected?(socket) do
          if old = socket.assigns.selected_agent_name do
            Phoenix.PubSub.unsubscribe(Shire.PubSub, "project:#{project}:agent:#{old}")
          end

          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project}:agent:#{name}")
        end

        {messages, has_more} = Agents.list_messages_for_agent(project, name, limit: 50)

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
    project = socket.assigns.project
    agent_name = socket.assigns.selected_agent_name

    case Coordinator.send_message(project, agent_name, text) do
      {:ok, msg} ->
        messages = socket.assigns.messages ++ [Helpers.serialize_message(msg)]
        {:noreply, assign(socket, :messages, messages)}

      :ok ->
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
    project = socket.assigns.project
    name = socket.assigns.selected_agent_name

    if name do
      {new_messages, has_more} =
        Agents.list_messages_for_agent(project, name, before: before, limit: 50)

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
  def handle_info({:agent_busy, agent_name, active}, socket) do
    busy_agents =
      if active do
        MapSet.put(socket.assigns.busy_agents, agent_name)
      else
        MapSet.delete(socket.assigns.busy_agents, agent_name)
      end

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
    agents = Coordinator.list_agents(socket.assigns.project)
    {:noreply, assign(socket, :agents, agents)}
  end

  @impl true
  def handle_info({:agent_updated, name}, socket) do
    project = socket.assigns.project
    agents = Coordinator.list_agents(project)

    selected_agent =
      if socket.assigns.selected_agent_name == name do
        case Coordinator.get_agent(project, name) do
          {:ok, agent} -> agent
          _ -> socket.assigns.selected_agent
        end
      else
        socket.assigns.selected_agent
      end

    {:noreply, assign(socket, agents: agents, selected_agent: selected_agent)}
  end

  @impl true
  def handle_info({:agent_renamed, old_name, new_name}, socket) do
    project = socket.assigns.project
    agents = Coordinator.list_agents(project)

    if socket.assigns.selected_agent_name == old_name do
      case Coordinator.get_agent(project, new_name) do
        {:ok, agent} ->
          if connected?(socket) do
            Phoenix.PubSub.unsubscribe(
              Shire.PubSub,
              "project:#{project}:agent:#{old_name}"
            )

            Phoenix.PubSub.subscribe(
              Shire.PubSub,
              "project:#{project}:agent:#{new_name}"
            )
          end

          {:noreply,
           assign(socket,
             agents: agents,
             selected_agent_name: new_name,
             selected_agent: agent
           )}

        _ ->
          {:noreply, assign(socket, agents: agents)}
      end
    else
      {:noreply, assign(socket, :agents, agents)}
    end
  end

  @impl true
  def handle_info({:agent_deleted, name}, socket) do
    agents = Coordinator.list_agents(socket.assigns.project)

    if socket.assigns.selected_agent_name == name do
      {:noreply,
       assign(socket,
         agents: agents,
         selected_agent_name: nil,
         selected_agent: nil,
         messages: []
       )}
    else
      {:noreply, assign(socket, :agents, agents)}
    end
  end

  @impl true
  def handle_info({:agent_status, agent_name, status}, socket) do
    statuses = Map.put(socket.assigns.agent_statuses, agent_name, status)

    selected_agent =
      if socket.assigns.selected_agent && socket.assigns.selected_agent_name == agent_name do
        Map.put(socket.assigns.selected_agent, :status, status)
      else
        socket.assigns.selected_agent
      end

    {:noreply, assign(socket, agent_statuses: statuses, selected_agent: selected_agent)}
  end

  @impl true
  def render(assigns) do
    agents_with_busy =
      Enum.map(assigns.agents, fn agent ->
        status = Map.get(assigns.agent_statuses, agent.name, agent.status)

        agent
        |> Map.put(:busy, MapSet.member?(assigns.busy_agents, agent.name))
        |> Map.put(:status, status)
      end)

    assigns = assign(assigns, :agents_with_busy, agents_with_busy)

    ~H"""
    <.react
      name="AgentDashboard"
      project={@project}
      projects={@projects}
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
