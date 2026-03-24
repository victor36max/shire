defmodule ShireWeb.AgentLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias Shire.Projects
  alias Shire.Agent.{AgentManager, Coordinator}
  alias Shire.ProjectManager
  alias Shire.Workspace
  alias ShireWeb.AgentLive.{AgentStreaming, Helpers}

  @max_attachment_size 50 * 1024 * 1024

  @impl true
  def mount(%{"project_name" => project_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)
    project_id = project.id

    case ProjectManager.lookup_coordinator(project_id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        if connected?(socket) do
          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents")
        end

        agents = Coordinator.list_agents(project_id)
        projects = ProjectManager.list_projects()
        unread_counts = Agents.unread_counts(project_id, agents)

        {:ok,
         assign(socket,
           project: %{id: project.id, name: project.name},
           projects: projects,
           agents: agents,
           unread_counts: unread_counts,
           selected_agent_id: nil,
           selected_agent: nil,
           messages: [],
           has_more: false,
           loading_more: false,
           streaming_text: nil,
           busy_agents: MapSet.new(),
           agent_statuses: %{},
           editing_agent: nil,
           catalog_agents:
             Shire.Catalog.list_agents()
             |> Enum.map(&Map.from_struct/1)
             |> Enum.map(&Map.drop(&1, [:system_prompt])),
           catalog_categories: Shire.Catalog.list_categories(),
           catalog_selected_agent: nil
         )}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agents")}
  end

  # Agent CRUD events

  @impl true
  def handle_event("delete-agent", %{"id" => agent_id}, socket) do
    project_id = socket.assigns.project.id

    case Coordinator.delete_agent(project_id, agent_id) do
      :ok ->
        agents = Coordinator.list_agents(project_id)

        selected =
          if socket.assigns.selected_agent_id == agent_id do
            nil
          else
            socket.assigns.selected_agent_id
          end

        {:noreply,
         assign(socket,
           agents: agents,
           selected_agent_id: selected,
           selected_agent: if(selected, do: socket.assigns.selected_agent, else: nil),
           messages: if(selected, do: socket.assigns.messages, else: [])
         )}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  def handle_event("edit-agent", %{"id" => agent_id}, socket) do
    case Coordinator.get_agent(socket.assigns.project.id, agent_id) do
      {:ok, agent} ->
        {:noreply, assign(socket, :editing_agent, agent)}

      {:error, _} ->
        {:noreply, put_flash(socket, :error, "Agent not found")}
    end
  end

  def handle_event("create-agent", params, socket) do
    project_id = socket.assigns.project.id

    case Coordinator.create_agent(project_id, params) do
      {:ok, _pid} ->
        agents = Coordinator.list_agents(project_id)

        {:noreply,
         socket
         |> assign(:agents, agents)
         |> assign(:editing_agent, nil)
         |> assign(:catalog_selected_agent, nil)
         |> put_flash(:info, "Agent created")}

      {:error, :already_exists} ->
        {:noreply, put_flash(socket, :error, "Agent already exists")}

      {:error, :no_vm} ->
        {:noreply, put_flash(socket, :error, "No VM available")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to create agent: #{inspect(reason)}")}
    end
  end

  def handle_event("get-catalog-agent", %{"name" => name}, socket) do
    case Shire.Catalog.get_agent(name) do
      %Shire.Catalog.Agent{} = agent ->
        # Include timestamp so useEffect fires even if same agent clicked twice
        agent_data = agent |> Map.from_struct() |> Map.put(:_ts, System.monotonic_time())
        {:noreply, assign(socket, :catalog_selected_agent, agent_data)}

      nil ->
        {:noreply, put_flash(socket, :error, "Catalog agent not found")}
    end
  end

  def handle_event("update-agent", params, socket) do
    project_id = socket.assigns.project.id
    agent_id = params["id"]

    case Coordinator.update_agent(project_id, agent_id, params) do
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
  def handle_event("select-agent", %{"id" => agent_id}, socket) do
    project_id = socket.assigns.project.id

    case Coordinator.get_agent(project_id, agent_id) do
      {:ok, agent} ->
        if connected?(socket) do
          if old = socket.assigns.selected_agent_id do
            Phoenix.PubSub.unsubscribe(Shire.PubSub, "project:#{project_id}:agent:#{old}")
          end

          Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agent:#{agent_id}")
        end

        {messages, has_more} = Agents.list_messages_for_agent(project_id, agent_id, limit: 50)

        latest_id =
          case List.last(messages) do
            nil -> nil
            msg -> msg.id
          end

        if latest_id, do: AgentManager.mark_read(project_id, agent_id, latest_id)

        {:noreply,
         assign(socket,
           selected_agent_id: agent_id,
           selected_agent: agent,
           messages: Enum.map(messages, &Helpers.serialize_message/1),
           has_more: has_more,
           streaming_text: nil,
           unread_counts: Map.put(socket.assigns.unread_counts, agent_id, 0)
         )}

      {:error, _} ->
        {:noreply, put_flash(socket, :error, "Agent not found")}
    end
  end

  @impl true
  def handle_event("send-message", %{"text" => text} = params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.selected_agent_id
    raw_attachments = Map.get(params, "attachments", [])

    case store_attachments(project_id, agent_id, raw_attachments) do
      {:ok, attachment_metas} ->
        opts = if attachment_metas == [], do: [], else: [attachments: attachment_metas]

        case Coordinator.send_message(project_id, agent_id, text, opts) do
          {:ok, msg} ->
            messages = socket.assigns.messages ++ [Helpers.serialize_message(msg)]
            {:noreply, assign(socket, :messages, messages)}

          :ok ->
            {:noreply, socket}

          {:error, reason} ->
            {:noreply, put_flash(socket, :error, "Failed to send: #{inspect(reason)}")}
        end

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Attachment error: #{reason}")}
    end
  catch
    :exit, _ ->
      {:noreply, put_flash(socket, :error, "Agent is not running. Start it first.")}
  end

  @impl true
  def handle_event("load-more", %{"before" => before}, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.selected_agent_id

    if agent_id do
      {new_messages, has_more} =
        Agents.list_messages_for_agent(project_id, agent_id, before: before, limit: 50)

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

  def handle_event("load-more", _params, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("restart-agent", _params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.selected_agent_id

    if agent_id do
      Coordinator.restart_agent(project_id, agent_id)
    end

    {:noreply, socket}
  end

  @impl true
  def handle_event("interrupt-agent", _params, socket) do
    project_id = socket.assigns.project.id
    agent_id = socket.assigns.selected_agent_id

    if agent_id do
      case Coordinator.interrupt_agent(project_id, agent_id) do
        :ok ->
          {:noreply, socket}

        {:error, reason} ->
          {:noreply, put_flash(socket, :error, "Failed to interrupt: #{inspect(reason)}")}
      end
    else
      {:noreply, socket}
    end
  catch
    :exit, _ ->
      {:noreply, put_flash(socket, :error, "Agent is not running.")}
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

  @impl true
  def handle_info({:new_message_notification, agent_id, message_id, role}, socket) do
    project_id = socket.assigns.project.id

    if agent_id == socket.assigns.selected_agent_id do
      AgentManager.mark_read(project_id, agent_id, message_id)
      {:noreply, socket}
    else
      if role == "agent" do
        unread_counts =
          Map.update(socket.assigns.unread_counts, agent_id, 1, &(&1 + 1))

        {:noreply, assign(socket, :unread_counts, unread_counts)}
      else
        {:noreply, socket}
      end
    end
  end

  @impl true
  def handle_info({:agent_busy, agent_id, active}, socket) do
    busy_agents =
      if active do
        MapSet.put(socket.assigns.busy_agents, agent_id)
      else
        MapSet.delete(socket.assigns.busy_agents, agent_id)
      end

    selected_agent =
      if socket.assigns.selected_agent && socket.assigns.selected_agent_id == agent_id do
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
  def handle_info({:agent_created, _id}, socket) do
    project_id = socket.assigns.project.id
    agents = Coordinator.list_agents(project_id)
    unread_counts = Agents.unread_counts(project_id, agents)
    {:noreply, assign(socket, agents: agents, unread_counts: unread_counts)}
  end

  @impl true
  def handle_info({:agent_updated, agent_id}, socket) do
    project_id = socket.assigns.project.id
    agents = Coordinator.list_agents(project_id)

    selected_agent =
      if socket.assigns.selected_agent_id == agent_id do
        case Coordinator.get_agent(project_id, agent_id) do
          {:ok, agent} -> agent
          _ -> socket.assigns.selected_agent
        end
      else
        socket.assigns.selected_agent
      end

    {:noreply, assign(socket, agents: agents, selected_agent: selected_agent)}
  end

  @impl true
  def handle_info({:agent_renamed, agent_id, _old_name, _new_name}, socket) do
    project_id = socket.assigns.project.id
    agents = Coordinator.list_agents(project_id)

    selected_agent =
      if socket.assigns.selected_agent_id == agent_id do
        case Coordinator.get_agent(project_id, agent_id) do
          {:ok, agent} -> agent
          _ -> socket.assigns.selected_agent
        end
      else
        socket.assigns.selected_agent
      end

    {:noreply, assign(socket, agents: agents, selected_agent: selected_agent)}
  end

  @impl true
  def handle_info({:agent_deleted, agent_id}, socket) do
    agents = Coordinator.list_agents(socket.assigns.project.id)

    if socket.assigns.selected_agent_id == agent_id do
      {:noreply,
       assign(socket,
         agents: agents,
         selected_agent_id: nil,
         selected_agent: nil,
         messages: []
       )}
    else
      {:noreply, assign(socket, :agents, agents)}
    end
  end

  @impl true
  def handle_info({:agent_status, agent_id, status}, socket) do
    statuses = Map.put(socket.assigns.agent_statuses, agent_id, status)

    selected_agent =
      if socket.assigns.selected_agent && socket.assigns.selected_agent_id == agent_id do
        Map.put(socket.assigns.selected_agent, :status, status)
      else
        socket.assigns.selected_agent
      end

    {:noreply, assign(socket, agent_statuses: statuses, selected_agent: selected_agent)}
  end

  # --- Private helpers ---

  defp store_attachments(_project_id, _agent_id, []), do: {:ok, []}

  defp store_attachments(project_id, agent_id, raw_attachments) do
    vm = Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
    suffix = :crypto.strong_rand_bytes(4) |> Base.encode16(case: :lower)
    attachment_id = "#{System.system_time(:millisecond)}-#{suffix}"
    dir = Workspace.attachment_dir(project_id, agent_id, attachment_id)

    with :ok <- vm.mkdir_p(project_id, dir) do
      Enum.reduce_while(raw_attachments, {:ok, []}, fn att, {:ok, acc} ->
        name = att["name"]
        base64_content = att["content"]
        content_type = att["content_type"] || "application/octet-stream"

        # Strip data URI prefix if present (e.g. "data:image/png;base64,...")
        raw_b64 =
          case String.split(base64_content, ",", parts: 2) do
            [_prefix, data] -> data
            [data] -> data
          end

        case Base.decode64(raw_b64) do
          {:ok, bytes} ->
            if byte_size(bytes) > @max_attachment_size do
              {:halt, {:error, "File #{name} exceeds 50MB limit"}}
            else
              safe_name = Path.basename(name)
              path = Workspace.attachment_path(project_id, agent_id, attachment_id, safe_name)

              case vm.write(project_id, path, bytes) do
                :ok ->
                  meta = %{
                    "id" => attachment_id,
                    "filename" => safe_name,
                    "size" => byte_size(bytes),
                    "content_type" => content_type
                  }

                  {:cont, {:ok, acc ++ [meta]}}

                {:error, reason} ->
                  {:halt, {:error, "Failed to store #{name}: #{inspect(reason)}"}}
              end
            end

          :error ->
            {:halt, {:error, "Invalid base64 for #{name}"}}
        end
      end)
    end
  end

  @impl true
  def render(assigns) do
    agents_with_busy =
      Enum.map(assigns.agents, fn agent ->
        status = Map.get(assigns.agent_statuses, agent.id, agent.status)

        agent
        |> Map.put(:busy, MapSet.member?(assigns.busy_agents, agent.id))
        |> Map.put(:status, status)
        |> Map.put(:unread_count, Map.get(assigns.unread_counts, agent.id, 0))
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
      catalogAgents={@catalog_agents}
      catalogCategories={@catalog_categories}
      catalogSelectedAgent={@catalog_selected_agent}
    />
    """
  end
end
