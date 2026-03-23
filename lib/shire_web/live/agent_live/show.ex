defmodule ShireWeb.AgentLive.Show do
  use ShireWeb, :live_view

  alias Shire.Agent.Coordinator
  alias Shire.Projects
  alias Shire.ProjectManager

  @impl true
  def mount(%{"project_name" => project_name, "agent_name" => agent_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)
    project_id = project.id
    agent_record = Shire.Agents.get_agent_by_name!(project_id, agent_name)
    agent_id = agent_record.id

    case ProjectManager.lookup_coordinator(project_id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        agent =
          try do
            case Coordinator.get_agent(project_id, agent_id) do
              {:ok, data} ->
                data

              {:error, _} ->
                %{
                  id: agent_id,
                  name: agent_name,
                  status: Coordinator.agent_status(project_id, agent_id)
                }
            end
          catch
            :exit, _ -> %{id: agent_id, name: agent_name, status: :created}
          end

        if connected?(socket) do
          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agent:#{agent_id}")
        end

        {:ok,
         assign(socket,
           project: %{id: project.id, name: project.name},
           agent: agent,
           agent_status: agent.status
         )}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agent")}
  end

  @impl true
  def handle_event("start-agent", _params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.agent.id

    case Coordinator.restart_agent(project_id, agent_id) do
      :ok ->
        {:noreply, put_flash(socket, :info, "Agent starting...")}

      {:error, :no_vm} ->
        {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to start agent: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("delete-agent", _params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.agent.id

    case Coordinator.delete_agent(project_id, agent_id) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent deleted")
         |> redirect(to: ~p"/projects/#{socket.assigns.project.name}")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("update-agent", params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.agent.id

    case Coordinator.update_agent(project_id, agent_id, params) do
      :ok ->
        agent =
          case Coordinator.get_agent(project_id, agent_id) do
            {:ok, data} -> data
            _ -> socket.assigns.agent
          end

        {:noreply,
         socket
         |> assign(:agent, agent)
         |> put_flash(:info, "Agent updated")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to update: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("restart-agent", _params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.agent.id

    case Coordinator.restart_agent(project_id, agent_id) do
      :ok ->
        {:noreply, put_flash(socket, :info, "Agent restarting...")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to restart: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_info({:agent_status, _agent_id, status}, socket) do
    agent = Map.put(socket.assigns.agent, :status, status)

    {:noreply,
     socket
     |> assign(:agent, agent)
     |> assign(:agent_status, status)}
  end

  @impl true
  def handle_info({:agent_busy, _agent_id, active}, socket) do
    agent = Map.put(socket.assigns.agent, :busy, active)
    {:noreply, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_info({:agent_renamed, _agent_id, _old_name, new_name}, socket) do
    agent = Map.put(socket.assigns.agent, :name, new_name)
    {:noreply, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_info({:agent_event, _agent_id, _event}, socket) do
    {:noreply, socket}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentShow"
      project={@project}
      agent={@agent}
      socket={@socket}
    />
    """
  end
end
