defmodule ShireWeb.AgentLive.Show do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Agents.Agent
  alias Shire.Agent.{AgentManager, Coordinator, TerminalSession}
  alias ShireWeb.AgentLive.Helpers

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent = Agents.get_agent!(id)
    secrets = Agents.list_secrets_for_agent(agent.id)
    agent_status = Coordinator.agent_status(agent.id)

    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{agent.id}")
    end

    {:ok,
     assign(socket,
       agent: agent,
       secrets: secrets,
       agent_status: agent_status
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    agent = socket.assigns.agent
    name = Agent.recipe_name(agent)
    {:noreply, assign(socket, :page_title, "Agent: #{name}")}
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
        # Not running in coordinator — delete the record directly
        Agents.delete_agent(agent)

        {:noreply,
         socket
         |> put_flash(:info, "Agent deleted")
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
  def handle_event("create-agent-secret", %{"secret" => params}, socket) do
    agent = socket.assigns.agent
    attrs = Map.put(params, "agent_id", agent.id)

    case Agents.create_secret(attrs) do
      {:ok, _secret} ->
        secrets = Agents.list_secrets_for_agent(agent.id)
        {:noreply, assign(socket, :secrets, secrets)}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to create secret")}
    end
  end

  @impl true
  def handle_event("update-agent-secret", %{"id" => id, "secret" => params}, socket) do
    secret = Agents.get_secret!(id)

    case Agents.update_secret(secret, params) do
      {:ok, _secret} ->
        secrets = Agents.list_secrets_for_agent(socket.assigns.agent.id)
        {:noreply, assign(socket, :secrets, secrets)}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to update secret")}
    end
  end

  @impl true
  def handle_event("delete-agent-secret", %{"id" => id}, socket) do
    secret = Agents.get_secret!(id)
    {:ok, _} = Agents.delete_secret(secret)
    secrets = Agents.list_secrets_for_agent(socket.assigns.agent.id)
    {:noreply, assign(socket, :secrets, secrets)}
  end

  @impl true
  def handle_event("connect-terminal", _params, socket) do
    agent = socket.assigns.agent

    case TerminalSession.find(agent.id) do
      {:ok, _pid} ->
        Phoenix.PubSub.subscribe(Shire.PubSub, "terminal:#{agent.id}")
        {:noreply, socket}

      :error ->
        try do
          case AgentManager.get_sprite(agent.id) do
            {:ok, sprite} when not is_nil(sprite) ->
              case TerminalSession.start_link(agent_id: agent.id, sprite: sprite) do
                {:ok, _pid} ->
                  Phoenix.PubSub.subscribe(Shire.PubSub, "terminal:#{agent.id}")
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
    Phoenix.PubSub.unsubscribe(Shire.PubSub, "terminal:#{agent.id}")
    {:noreply, socket}
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
  def handle_info({:agent_event, _event}, socket) do
    {:noreply, socket}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentShow"
      agent={Helpers.serialize_agent(@agent, MapSet.new(), %{@agent.id => @agent_status})}
      secrets={Helpers.serialize_secrets(@secrets)}
      socket={@socket}
    />
    """
  end
end
