defmodule ShireWeb.AgentLive.Show do
  use ShireWeb, :live_view

  alias Shire.Agent.{AgentManager, Coordinator, TerminalSession}
  alias ShireWeb.AgentLive.Helpers

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent_status = Coordinator.agent_status(id)

    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{id}")
    end

    {:ok,
     assign(socket,
       agent: %{id: id},
       agent_status: agent_status,
       terminal_subscribed: false
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agent")}
  end

  @impl true
  def handle_event("start-agent", _params, socket) do
    agent = socket.assigns.agent

    case Coordinator.start_agent(agent.id) do
      {:ok, _pid} ->
        {:noreply, put_flash(socket, :info, "Agent starting...")}

      {:error, :already_running} ->
        {:noreply, put_flash(socket, :error, "Agent is already running")}

      {:error, :no_sprites_token} ->
        {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to start agent: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("kill-agent", _params, socket) do
    agent = socket.assigns.agent

    case Coordinator.kill_agent(agent.id) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent killed — VM destroyed")
         |> redirect(to: ~p"/")}

      {:error, :not_found} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent not found")
         |> redirect(to: ~p"/")}
    end
  end

  @impl true
  def handle_event("restart-agent", _params, socket) do
    agent = socket.assigns.agent

    case Coordinator.restart_agent(agent.id) do
      :ok ->
        {:noreply, put_flash(socket, :info, "Agent restarting...")}

      {:error, :not_found} ->
        {:noreply, put_flash(socket, :error, "Agent is not running")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to restart: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("update-agent", _params, socket) do
    {:noreply, socket}
  end

  # Secret handlers — stubbed out, will be rewritten in Phase 4

  @impl true
  def handle_event("create-agent-secret", _params, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("update-agent-secret", _params, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("delete-agent-secret", _params, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("connect-terminal", _params, socket) do
    agent = socket.assigns.agent

    case TerminalSession.find(agent.id) do
      {:ok, _pid} ->
        socket = subscribe_terminal(socket, agent.id)
        {:noreply, socket}

      :error ->
        try do
          case AgentManager.get_sprite(agent.id) do
            {:ok, sprite} when not is_nil(sprite) ->
              case TerminalSession.start_link(agent_id: agent.id, sprite: sprite) do
                {:ok, _pid} ->
                  socket = subscribe_terminal(socket, agent.id)
                  {:noreply, socket}

                {:error, reason} ->
                  {:noreply,
                   push_event(socket, "terminal-exit", %{code: 1, error: inspect(reason)})}
              end

            _ ->
              {:noreply,
               push_event(socket, "terminal-exit", %{code: 1, error: "No sprite available"})}
          end
        catch
          :exit, _ ->
            {:noreply,
             push_event(socket, "terminal-exit", %{code: 1, error: "Agent is not running"})}
        end
    end
  end

  @impl true
  def handle_event("disconnect-terminal", _params, socket) do
    agent = socket.assigns.agent

    if socket.assigns.terminal_subscribed do
      Phoenix.PubSub.unsubscribe(Shire.PubSub, "terminal:#{agent.id}")
    end

    {:noreply, assign(socket, :terminal_subscribed, false)}
  end

  @impl true
  def handle_event("terminal-input", %{"data" => data}, socket) do
    agent = socket.assigns.agent

    case TerminalSession.find(agent.id) do
      {:ok, pid} -> TerminalSession.write(pid, data)
      :error -> :ok
    end

    {:noreply, socket}
  end

  @impl true
  def handle_event("terminal-resize", %{"rows" => rows, "cols" => cols}, socket) do
    agent = socket.assigns.agent

    case TerminalSession.find(agent.id) do
      {:ok, pid} -> TerminalSession.resize(pid, rows, cols)
      :error -> :ok
    end

    {:noreply, socket}
  end

  defp subscribe_terminal(socket, agent_id) do
    unless socket.assigns.terminal_subscribed do
      Phoenix.PubSub.subscribe(Shire.PubSub, "terminal:#{agent_id}")
    end

    assign(socket, :terminal_subscribed, true)
  end

  @impl true
  def handle_info({:terminal_output, data}, socket) do
    {:noreply, push_event(socket, "terminal-output", %{data: Base.encode64(data)})}
  end

  @impl true
  def handle_info({:terminal_exit, code}, socket) do
    {:noreply, push_event(socket, "terminal-exit", %{code: code})}
  end

  @impl true
  def handle_info({:status, status}, socket) do
    {:noreply, assign(socket, :agent_status, status)}
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
      agent={Helpers.serialize_agent(@agent)}
      secrets={[]}
      baseRecipes={[]}
      socket={@socket}
    />
    """
  end
end
