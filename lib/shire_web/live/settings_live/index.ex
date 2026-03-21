defmodule ShireWeb.SettingsLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Projects
  alias Shire.Agent.TerminalSession
  alias Shire.ProjectManager
  alias Shire.WorkspaceSettings

  @impl true
  def mount(%{"project_name" => project_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)
    project_id = project.id

    case ProjectManager.lookup_coordinator(project_id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        {messages, has_more} = Agents.list_inter_agent_messages(project_id, limit: 100)

        env_content =
          case WorkspaceSettings.read_env(project_id) do
            {:ok, content} -> content
            _ -> ""
          end

        scripts =
          case WorkspaceSettings.read_all_scripts(project_id) do
            {:ok, list} -> list
            _ -> []
          end

        {:ok,
         assign(socket,
           project: %{id: project.id, name: project.name},
           messages: messages,
           has_more_messages: has_more,
           env_content: env_content,
           scripts: scripts,
           terminal_subscribed: false
         )}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Settings")}
  end

  # Env events

  @impl true
  def handle_event("save-env", %{"content" => content}, socket) do
    case WorkspaceSettings.write_env(socket.assigns.project.id, content) do
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
    project_id = socket.assigns.project.id

    case WorkspaceSettings.write_script(project_id, name, content) do
      :ok ->
        scripts = refresh_scripts(project_id)

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
    :ok = WorkspaceSettings.delete_script(socket.assigns.project.id, name)

    {:noreply,
     socket
     |> assign(:scripts, refresh_scripts(socket.assigns.project.id))
     |> put_flash(:info, "Script deleted")}
  end

  @impl true
  def handle_event("run-script", %{"name" => name}, socket) do
    case WorkspaceSettings.run_script(socket.assigns.project.id, name) do
      {:ok, output} ->
        {:noreply, put_flash(socket, :info, "Script output:\n#{String.slice(output, 0, 500)}")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Script failed: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event(
        "rename-script",
        %{"old_name" => old_name, "new_name" => new_name, "content" => content},
        socket
      ) do
    project_id = socket.assigns.project.id

    with :ok <- WorkspaceSettings.write_script(project_id, new_name, content),
         :ok <- WorkspaceSettings.delete_script(project_id, old_name) do
      {:noreply,
       socket
       |> assign(:scripts, refresh_scripts(project_id))
       |> put_flash(:info, "Script renamed")}
    else
      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to rename script: #{inspect(reason)}")}
    end
  end

  # Activity log pagination

  @impl true
  def handle_event("load-more-messages", %{"before" => before}, socket) do
    {new_messages, has_more} =
      Agents.list_inter_agent_messages(socket.assigns.project.id, before: before, limit: 100)

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
    project_id = socket.assigns.project.id

    case TerminalSession.find(project_id) do
      {:ok, _pid} ->
        {:noreply, subscribe_terminal(socket)}

      :error ->
        case start_terminal(project_id) do
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
      Phoenix.PubSub.unsubscribe(
        Shire.PubSub,
        "project:#{socket.assigns.project.id}:terminal"
      )
    end

    {:noreply, assign(socket, :terminal_subscribed, false)}
  end

  @impl true
  def handle_event("terminal-input", %{"data" => data}, socket) do
    project_id = socket.assigns.project.id

    case TerminalSession.find(project_id) do
      {:ok, _pid} -> TerminalSession.write(project_id, data)
      :error -> :ok
    end

    {:noreply, socket}
  end

  @impl true
  def handle_event("terminal-resize", %{"rows" => rows, "cols" => cols}, socket) do
    project_id = socket.assigns.project.id

    case TerminalSession.find(project_id) do
      {:ok, _pid} -> TerminalSession.resize(project_id, rows, cols)
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
    project_id = socket.assigns.project.id

    unless socket.assigns.terminal_subscribed do
      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:terminal")
    end

    assign(socket, :terminal_subscribed, true)
  end

  defp start_terminal(project_id) do
    sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}}

    DynamicSupervisor.start_child(
      sup,
      {TerminalSession, project_id: project_id}
    )
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SettingsPage"
      project={@project}
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
      base = %{
        id: msg.id,
        text: msg.content["text"],
        ts: msg.inserted_at |> to_string()
      }

      if msg.content["trigger"] == "scheduled_task" do
        Map.merge(base, %{
          trigger: "scheduled_task",
          task_label: msg.content["task_label"],
          from_agent: "Scheduled",
          to_agent: ""
        })
      else
        Map.merge(base, %{
          from_agent: msg.content["from_agent"],
          to_agent: msg.content["to_agent"]
        })
      end
    end)
  end

  defp refresh_scripts(project_id) do
    case WorkspaceSettings.read_all_scripts(project_id) do
      {:ok, list} -> list
      _ -> []
    end
  end
end
