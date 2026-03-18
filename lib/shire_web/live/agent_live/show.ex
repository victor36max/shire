defmodule ShireWeb.AgentLive.Show do
  use ShireWeb, :live_view

  alias Shire.Agent.Coordinator

  @impl true
  def mount(%{"name" => name}, _session, socket) do
    agent =
      try do
        case Coordinator.get_agent(name) do
          {:ok, data} -> data
          {:error, _} -> %{name: name, status: Coordinator.agent_status(name)}
        end
      catch
        :exit, _ -> %{name: name, status: :created}
      end

    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{name}")
    end

    {:ok,
     assign(socket,
       agent: agent,
       agent_status: agent.status
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agent")}
  end

  @impl true
  def handle_event("start-agent", _params, socket) do
    name = socket.assigns.agent.name

    case Coordinator.restart_agent(name) do
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
    name = socket.assigns.agent.name

    case Coordinator.delete_agent(name) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent deleted")
         |> redirect(to: ~p"/")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("update-agent", params, socket) do
    name = socket.assigns.agent.name

    case Coordinator.update_agent(name, params) do
      :ok ->
        agent =
          case Coordinator.get_agent(name) do
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
    name = socket.assigns.agent.name

    case Coordinator.restart_agent(name) do
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

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentShow"
      agent={@agent}
      socket={@socket}
    />
    """
  end
end
