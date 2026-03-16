defmodule SpriteAgentsWeb.AgentLive.Show do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent
  alias SpriteAgents.Agent.{AgentManager, TerminalSession}

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent = Agents.get_agent!(id)

    if connected?(socket) do
      Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "agent:#{agent.id}")
    end

    {messages, has_more} = Agents.list_messages_for_agent(agent.id, limit: 50)

    {:ok,
     assign(socket,
       agent: agent,
       messages: Enum.map(messages, &serialize_message/1),
       has_more: has_more,
       loading_more: false,
       streaming_text: nil
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    agent = socket.assigns.agent
    name = Agent.recipe_name(agent)
    {:noreply, assign(socket, :page_title, "Agent: #{name}")}
  end

  @impl true
  def handle_event("edit", %{"id" => id}, socket) do
    {:noreply, push_navigate(socket, to: ~p"/agents/#{id}/edit")}
  end

  @impl true
  def handle_event("start-agent", _params, socket) do
    agent = socket.assigns.agent

    case SpriteAgents.Agent.Coordinator.start_agent(agent.id) do
      {:ok, _pid} ->
        agent = Agents.get_agent!(agent.id)

        {:noreply,
         socket
         |> assign(:agent, agent)
         |> put_flash(:info, "Agent starting...")}

      {:error, :already_running} ->
        {:noreply, put_flash(socket, :error, "Agent is already running")}

      {:error, :no_sprites_token} ->
        {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to start agent: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("send-message", %{"text" => text}, socket) do
    agent = socket.assigns.agent

    case SpriteAgents.Agent.Coordinator.send_message(agent.id, text) do
      :ok ->
        {:ok, msg} =
          Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => text}})

        messages = socket.assigns.messages ++ [serialize_message(msg)]
        {:noreply, assign(socket, :messages, messages)}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to send: #{inspect(reason)}")}
    end
  catch
    :exit, _ ->
      {:noreply, put_flash(socket, :error, "Agent is not running. Start it first.")}
  end

  @impl true
  def handle_event("load-more", _params, socket) do
    if !socket.assigns.has_more || socket.assigns.loading_more do
      {:noreply, socket}
    else
      socket = assign(socket, :loading_more, true)
      messages = socket.assigns.messages
      cursor = if messages != [], do: List.first(messages)[:id]

      {older, has_more} =
        Agents.list_messages_for_agent(socket.assigns.agent.id,
          before: cursor,
          limit: 50
        )

      older_serialized = Enum.map(older, &serialize_message/1)

      {:noreply,
       assign(socket,
         messages: older_serialized ++ messages,
         has_more: has_more,
         loading_more: false
       )}
    end
  end

  @impl true
  def handle_event("stop-agent", _params, socket) do
    agent = socket.assigns.agent

    case SpriteAgents.Agent.Coordinator.stop_agent(agent.id) do
      :ok ->
        agent = Agents.get_agent!(agent.id)

        {:noreply,
         socket
         |> assign(:agent, agent)
         |> put_flash(:info, "Agent stopped")}

      {:error, :not_found} ->
        # Process already dead — ensure DB status reflects reality
        agent = Agents.get_agent!(agent.id)

        if agent.status in [:active, :starting] do
          {:ok, agent} = Agents.update_agent(agent, %{status: :created})

          {:noreply,
           socket
           |> assign(:agent, agent)
           |> put_flash(:info, "Agent was not running — status updated")}
        else
          {:noreply,
           socket
           |> assign(:agent, agent)
           |> put_flash(:error, "Agent is not running")}
        end
    end
  end

  @impl true
  def handle_event("connect-terminal", _params, socket) do
    agent = socket.assigns.agent

    case TerminalSession.find(agent.id) do
      {:ok, _pid} ->
        Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "terminal:#{agent.id}")
        {:noreply, socket}

      :error ->
        case AgentManager.get_sprite(agent.id) do
          {:ok, sprite} when not is_nil(sprite) ->
            case TerminalSession.start_link(agent_id: agent.id, sprite: sprite) do
              {:ok, _pid} ->
                Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "terminal:#{agent.id}")
                {:noreply, socket}

              {:error, reason} ->
                {:noreply,
                 push_event(socket, "terminal-exit", %{code: 1, error: inspect(reason)})}
            end

          _ ->
            {:noreply,
             push_event(socket, "terminal-exit", %{code: 1, error: "No sprite available"})}
        end
    end
  end

  @impl true
  def handle_event("disconnect-terminal", _params, socket) do
    agent = socket.assigns.agent
    Phoenix.PubSub.unsubscribe(SpriteAgents.PubSub, "terminal:#{agent.id}")
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
  def handle_info({:status, _status}, socket) do
    agent = Agents.get_agent!(socket.assigns.agent.id)
    {:noreply, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_info({:agent_event, event}, socket) do
    agent = socket.assigns.agent
    messages = socket.assigns.messages
    streaming_text = socket.assigns.streaming_text

    {messages, streaming_text} =
      case event do
        %{"type" => "text_delta", "payload" => %{"delta" => delta}} ->
          {messages, (streaming_text || "") <> delta}

        %{"type" => "tool_use", "payload" => %{"status" => "started"} = payload} ->
          tool = Map.get(payload, "tool", "unknown")
          tool_use_id = Map.get(payload, "tool_use_id", "")
          input = Map.get(payload, "input", %{})

          messages = flush_streaming(messages, streaming_text, agent.id)

          {:ok, msg} =
            Agents.create_message(%{
              agent_id: agent.id,
              role: "tool_use",
              content: %{
                "tool" => tool,
                "tool_use_id" => tool_use_id,
                "input" => input,
                "output" => nil,
                "is_error" => false
              }
            })

          {messages ++ [serialize_message(msg)], nil}

        %{"type" => "tool_use", "payload" => %{"status" => "input_ready"} = payload} ->
          tool_use_id = Map.get(payload, "tool_use_id", "")
          input = Map.get(payload, "input", %{})

          idx =
            Enum.find_index(Enum.reverse(messages), fn msg ->
              msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
            end)

          if idx do
            real_idx = length(messages) - 1 - idx
            tool_msg = Enum.at(messages, real_idx)

            if db_id = tool_msg[:id] do
              db_msg = Agents.get_message!(db_id)

              Agents.update_message(db_msg, %{
                content: Map.merge(db_msg.content, %{"input" => input})
              })
            end

            updated = %{tool_msg | input: input}
            {List.replace_at(messages, real_idx, updated), streaming_text}
          else
            tool = Map.get(payload, "tool", "unknown")
            messages = flush_streaming(messages, streaming_text, agent.id)

            {:ok, msg} =
              Agents.create_message(%{
                agent_id: agent.id,
                role: "tool_use",
                content: %{
                  "tool" => tool,
                  "tool_use_id" => tool_use_id,
                  "input" => input,
                  "output" => nil,
                  "is_error" => false
                }
              })

            {messages ++ [serialize_message(msg)], nil}
          end

        %{"type" => "tool_result", "payload" => payload} ->
          tool_use_id = Map.get(payload, "tool_use_id", "")
          output = Map.get(payload, "output", "")
          is_error = Map.get(payload, "is_error", false)

          idx =
            Enum.find_index(Enum.reverse(messages), fn msg ->
              msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
            end)

          if idx do
            real_idx = length(messages) - 1 - idx
            tool_msg = Enum.at(messages, real_idx)

            if db_id = tool_msg[:id] do
              db_msg = Agents.get_message!(db_id)

              Agents.update_message(db_msg, %{
                content: Map.merge(db_msg.content, %{"output" => output, "is_error" => is_error})
              })
            end

            updated = %{tool_msg | output: output, is_error: is_error}
            {List.replace_at(messages, real_idx, updated), streaming_text}
          else
            {messages, streaming_text}
          end

        %{"type" => "turn_complete"} ->
          messages = flush_streaming(messages, streaming_text, agent.id)
          {messages, nil}

        %{"type" => "text", "payload" => %{"text" => text}} ->
          messages = flush_streaming(messages, streaming_text, agent.id)

          {:ok, msg} =
            Agents.create_message(%{
              agent_id: agent.id,
              role: "agent",
              content: %{"text" => text}
            })

          {messages ++ [serialize_message(msg)], nil}

        _ ->
          {messages, streaming_text}
      end

    display_messages =
      if streaming_text do
        messages ++
          [
            %{
              role: "agent_streaming",
              text: streaming_text,
              ts: DateTime.utc_now() |> to_string()
            }
          ]
      else
        messages
      end

    {:noreply, assign(socket, messages: display_messages, streaming_text: streaming_text)}
  end

  defp flush_streaming(messages, nil, _agent_id), do: messages
  defp flush_streaming(messages, "", _agent_id), do: messages

  defp flush_streaming(messages, text, agent_id) do
    {:ok, msg} =
      Agents.create_message(%{agent_id: agent_id, role: "agent", content: %{"text" => text}})

    messages ++ [serialize_message(msg)]
  end

  defp serialize_message(%Agents.Message{} = msg) do
    base = %{id: msg.id, role: msg.role, ts: msg.inserted_at |> to_string()}

    case msg.role do
      "tool_use" ->
        Map.merge(base, %{
          tool: msg.content["tool"],
          tool_use_id: msg.content["tool_use_id"],
          input: msg.content["input"],
          output: msg.content["output"],
          is_error: msg.content["is_error"] || false
        })

      _ ->
        Map.put(base, :text, msg.content["text"])
    end
  end

  defp serialize_agent(agent) do
    base =
      agent
      |> Map.from_struct()
      |> Map.drop([:__meta__, :secrets, :messages])
      |> Map.update(:inserted_at, nil, &to_string/1)
      |> Map.update(:updated_at, nil, &to_string/1)

    case Agent.parse_recipe(agent) do
      {:ok, parsed} ->
        Map.merge(base, %{
          name: parsed["name"],
          description: parsed["description"],
          harness: parsed["harness"] || "pi",
          model: parsed["model"],
          system_prompt: parsed["system_prompt"],
          scripts: parsed["scripts"] || []
        })

      _ ->
        Map.merge(base, %{name: "invalid recipe", harness: "pi"})
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentShow"
      agent={serialize_agent(@agent)}
      messages={@messages}
      hasMore={@has_more}
      loadingMore={@loading_more}
      socket={@socket}
    />
    """
  end
end
