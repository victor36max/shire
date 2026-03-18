defmodule ShireWeb.SettingsLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Agent.{Coordinator, TerminalSession}

  @impl true
  def mount(_params, _session, socket) do
    {messages, has_more} = Agents.list_inter_agent_messages(limit: 100)

    # Load env and scripts from VM (best-effort, empty on failure)
    env_content =
      case Coordinator.read_env() do
        {:ok, content} -> content
        _ -> ""
      end

    scripts =
      case Coordinator.list_scripts() do
        {:ok, names} -> names
        _ -> []
      end

    {:ok,
     assign(socket,
       messages: messages,
       has_more_messages: has_more,
       env_content: env_content,
       scripts: scripts,
       terminal_subscribed: false
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Settings")}
  end

  # Env events

  @impl true
  def handle_event("save-env", %{"content" => content}, socket) do
    case Coordinator.write_env(content) do
      :ok ->
        {:noreply,
         socket
         |> assign(:env_content, content)
         |> put_flash(:info, "Environment saved")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to save: #{inspect(reason)}")}
    end
  end

  # Script events

  @impl true
  def handle_event("save-script", %{"name" => name, "content" => content}, socket) do
    case Coordinator.write_script(name, content) do
      :ok ->
        scripts = refresh_scripts()

        {:noreply,
         socket
         |> assign(:scripts, scripts)
         |> put_flash(:info, "Script saved")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to save script: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("delete-script", %{"name" => name}, socket) do
    case Coordinator.delete_script(name) do
      :ok ->
        scripts = refresh_scripts()

        {:noreply,
         socket
         |> assign(:scripts, scripts)
         |> put_flash(:info, "Script deleted")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete script: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("run-script", %{"name" => name}, socket) do
    case Coordinator.run_script(name) do
      {:ok, output} ->
        {:noreply, put_flash(socket, :info, "Script output:\n#{String.slice(output, 0, 500)}")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Script failed: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("read-script", %{"name" => name}, socket) do
    case Coordinator.read_script(name) do
      {:ok, content} ->
        {:noreply, push_event(socket, "script-content", %{name: name, content: content})}

      {:error, _} ->
        {:noreply, push_event(socket, "script-content", %{name: name, content: ""})}
    end
  end

  # Activity log pagination

  @impl true
  def handle_event("load-more-messages", %{"before" => before}, socket) do
    {new_messages, has_more} = Agents.list_inter_agent_messages(before: before, limit: 100)
    all_messages = socket.assigns.messages ++ new_messages

    {:noreply,
     assign(socket,
       messages: all_messages,
       has_more_messages: has_more
     )}
  end

  # Global terminal events

  @impl true
  def handle_event("connect-terminal", _params, socket) do
    case TerminalSession.find() do
      {:ok, _pid} ->
        {:noreply, subscribe_terminal(socket)}

      :error ->
        case TerminalSession.start_link([]) do
          {:ok, _pid} ->
            {:noreply, subscribe_terminal(socket)}

          {:error, reason} ->
            {:noreply, push_event(socket, "terminal-exit", %{code: 1, error: inspect(reason)})}
        end
    end
  end

  @impl true
  def handle_event("disconnect-terminal", _params, socket) do
    if socket.assigns.terminal_subscribed do
      Phoenix.PubSub.unsubscribe(Shire.PubSub, "terminal:global")
    end

    {:noreply, assign(socket, :terminal_subscribed, false)}
  end

  @impl true
  def handle_event("terminal-input", %{"data" => data}, socket) do
    case TerminalSession.find() do
      {:ok, _pid} -> TerminalSession.write(data)
      :error -> :ok
    end

    {:noreply, socket}
  end

  @impl true
  def handle_event("terminal-resize", %{"rows" => rows, "cols" => cols}, socket) do
    case TerminalSession.find() do
      {:ok, _pid} -> TerminalSession.resize(rows, cols)
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

  defp subscribe_terminal(socket) do
    unless socket.assigns.terminal_subscribed do
      Phoenix.PubSub.subscribe(Shire.PubSub, "terminal:global")
    end

    assign(socket, :terminal_subscribed, true)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SettingsPage"
      env_content={@env_content}
      scripts={@scripts}
      messages={serialize_inter_agent_messages(@messages)}
      has_more_messages={@has_more_messages}
      socket={@socket}
    />
    """
  end

  defp serialize_inter_agent_messages(messages) do
    Enum.map(messages, fn msg ->
      %{
        id: msg.id,
        from_agent: msg.content["from_agent"],
        to_agent: msg.content["to_agent"],
        text: msg.content["text"],
        ts: msg.inserted_at |> to_string()
      }
    end)
  end

  defp refresh_scripts do
    case Coordinator.list_scripts() do
      {:ok, names} -> names
      _ -> []
    end
  end
end
