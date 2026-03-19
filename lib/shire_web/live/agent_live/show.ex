defmodule ShireWeb.AgentLive.Show do
  use ShireWeb, :live_view

  alias Shire.Agent.Coordinator
  alias Shire.ProjectManager

  @impl true
  def mount(%{"project" => project, "name" => name}, _session, socket) do
    case ProjectManager.lookup_coordinator(project) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        agent =
          try do
            case Coordinator.get_agent(project, name) do
              {:ok, data} -> data
              {:error, _} -> %{name: name, status: Coordinator.agent_status(project, name)}
            end
          catch
            :exit, _ -> %{name: name, status: :created}
          end

        if connected?(socket) do
          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project}:agent:#{name}")
        end

        {:ok,
         assign(socket,
           project: project,
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
    project = socket.assigns.project
    name = socket.assigns.agent.name

    case Coordinator.restart_agent(project, name) do
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
    project = socket.assigns.project
    name = socket.assigns.agent.name

    case Coordinator.delete_agent(project, name) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent deleted")
         |> redirect(to: ~p"/projects/#{project}")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("update-agent", params, socket) do
    project = socket.assigns.project
    name = socket.assigns.agent.name
    new_name = extract_name_from_recipe(params["recipe_yaml"])

    case Coordinator.update_agent(project, name, params) do
      :ok ->
        if new_name && new_name != name do
          {:noreply,
           socket
           |> put_flash(:info, "Agent renamed to #{new_name}")
           |> push_navigate(to: ~p"/projects/#{project}/agents/#{new_name}")}
        else
          agent =
            case Coordinator.get_agent(project, name) do
              {:ok, data} -> data
              _ -> socket.assigns.agent
            end

          {:noreply,
           socket
           |> assign(:agent, agent)
           |> put_flash(:info, "Agent updated")}
        end

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to update: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("restart-agent", _params, socket) do
    project = socket.assigns.project
    name = socket.assigns.agent.name

    case Coordinator.restart_agent(project, name) do
      :ok ->
        {:noreply, put_flash(socket, :info, "Agent restarting...")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to restart: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_info({:status, status}, socket) do
    agent = Map.put(socket.assigns.agent, :status, status)

    {:noreply,
     socket
     |> assign(:agent, agent)
     |> assign(:agent_status, status)}
  end

  @impl true
  def handle_info({:agent_busy, _agent_name, active}, socket) do
    agent = Map.put(socket.assigns.agent, :busy, active)
    {:noreply, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_info({:agent_event, _agent_name, _event}, socket) do
    {:noreply, socket}
  end

  defp extract_name_from_recipe(nil), do: nil

  defp extract_name_from_recipe(recipe_yaml) do
    case YamlElixir.read_from_string(recipe_yaml) do
      {:ok, %{"name" => name}} when is_binary(name) -> name
      _ -> nil
    end
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
