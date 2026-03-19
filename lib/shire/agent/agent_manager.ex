defmodule Shire.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's lifecycle on a project's Sprite VM.
  One AgentManager per active agent. Uses Shire.VirtualMachine for all
  VM operations — does not hold sprite/fs references.
  """
  use GenServer
  require Logger

  alias Shire.Agents

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  defp comms_prompt(agent_name, agent_id) do
    """
    # Inter-Agent Communication

    You are **#{agent_name}**, one of several agents running in a shared environment.

    ## First Responder Rule
    When the user sends you a message, YOU are the lead for that task:
    - You are responsible for delivering the final result to the user
    - Delegate to other agents when they have capabilities you lack
    - When you receive replies, synthesize their input and present the final answer
    - The user sees YOUR output, not the other agents' — always produce the complete response

    ## Discovering Peers
    Read `/workspace/peers.yaml` to see available agents and their descriptions.

    ## Sending Messages
    To message another agent, write a YAML file to your **outbox**:

    **Path:** `/workspace/agents/#{agent_id}/outbox/<any-name>.yaml`

    **Format:**
    ```yaml
    to: <target-agent-name>
    text: "<your message>"
    ```

    Example using Bash:
    ```bash
    cat > /workspace/agents/#{agent_id}/outbox/msg.yaml <<'EOF'
    to: target-agent
    text: "Hello, can you help me with X?"
    EOF
    ```

    **Note:** Always quote the `text` value if it contains special characters like `:`, `#`, `{`, `}`, or newlines.

    The system delivers the message to the target agent automatically.
    If your message is invalid (unparseable YAML or missing required fields), you will receive a system notification with the error details.

    ## Receiving Messages
    Messages arrive in your conversation automatically:
    - **User messages:** sent directly by the user
    - **Agent messages:** arrive prefixed with `[Message from agent "<name>"]`

    When you are the lead (user messaged you), incorporate agent replies into your final response.
    When another agent asked you for help, send your result back via a new outbox message.

    ## Your Workspace
    Your agent directory contains these subdirectories:
    - `scripts/` — Save reusable automation scripts (bash, JS/TS, Python) for future use
    - `documents/` — Store internal documents, notes, or references worth keeping

    ## Shared Drive
    All agents can read and write files in `/workspace/shared/`. Use this for sharing documents,
    data, or artifacts that multiple agents need access to.

    ## Guidelines
    - Read `/workspace/peers.yaml` before messaging to confirm the target agent exists
    - Be specific about what you need from the other agent
    - Don't send messages unnecessarily — only when collaboration genuinely helps
    """
  end

  @max_auto_restarts 3

  defstruct [
    :agent_id,
    :agent_name,
    :project_id,
    :command,
    :command_ref,
    :pubsub_topic,
    status: :idle,
    buffer: "",
    streaming_text: nil,
    tool_use_ids: %{},
    auto_restart_count: 0
  ]

  # --- Public API ---

  def start_link(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    agent_id = Keyword.fetch!(opts, :agent_id)
    GenServer.start_link(__MODULE__, opts, name: via(project_id, agent_id))
  end

  def send_message(project_id, agent_id, text, from \\ :user) do
    GenServer.call(via(project_id, agent_id), {:send_message, text, from}, 60_000)
  end

  @spec get_state(atom() | pid() | {atom(), any()} | {:via, atom(), any()}) :: any()
  def get_state(server) do
    GenServer.call(server, :get_state, 60_000)
  end

  def restart(project_id, agent_id) do
    GenServer.call(via(project_id, agent_id), :restart, 60_000)
  end

  @doc """
  Attempts an automatic restart (e.g., after VM wake-up). Returns `{:error, :max_retries}`
  if the agent has already failed too many consecutive restarts.
  """
  def auto_restart(project_id, agent_id) do
    GenServer.call(via(project_id, agent_id), :auto_restart, 60_000)
  end

  defp via(project_id, agent_id) do
    {:via, Registry, {Shire.AgentRegistry, {project_id, agent_id}, agent_id}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    agent_id = Keyword.fetch!(opts, :agent_id)
    agent_name = Keyword.fetch!(opts, :agent_name)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      project_id: project_id,
      agent_id: agent_id,
      agent_name: agent_name,
      pubsub_topic: "project:#{project_id}:agent:#{agent_id}",
      status: :idle
    }

    if skip_sprite do
      {:ok, state}
    else
      {:ok, state, {:continue, :bootstrap}}
    end
  end

  @impl true
  def handle_continue(:bootstrap, state) do
    state = transition_status(state, :bootstrapping)

    Task.start_link(fn ->
      result = setup_agent_workspace(state.project_id, state.agent_id, state.agent_name)
      GenServer.cast(via(state.project_id, state.agent_id), {:bootstrap_complete, result})
    end)

    {:noreply, state}
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    agent_dir = "/workspace/agents/#{state.agent_id}"
    kill_existing_runner(state.project_id, state.agent_id)
    env = load_env_vars(state.project_id)

    case @vm.spawn_command(
           state.project_id,
           "bun",
           ["run", "/workspace/.runner/agent-runner.ts", "--agent-dir", agent_dir],
           env: env,
           dir: agent_dir
         ) do
      {:ok, command} ->
        state =
          %{state | command: command, command_ref: command.ref, auto_restart_count: 0}
          |> transition_status(:active)

        {:noreply, state}

      {:error, reason} ->
        Logger.error("Failed to spawn agent runner for #{state.agent_name}: #{inspect(reason)}")
        {:noreply, transition_status(state, :idle)}
    end
  end

  @impl true
  def handle_call({:send_message, text, _from}, _from_pid, %{status: :active} = state) do
    envelope = %{
      "ts" => System.system_time(:millisecond),
      "type" => "user_message",
      "from" => "user",
      "payload" => %{"text" => text}
    }

    inbox_dir = "/workspace/agents/#{state.agent_id}/inbox"
    filename = "#{envelope["ts"]}-#{random_suffix()}.yaml"
    inbox_path = "#{inbox_dir}/#{filename}"

    case Agents.send_message_with_inbox(
           state.project_id,
           state.agent_id,
           text,
           inbox_path,
           envelope
         ) do
      {:ok, msg} ->
        {:reply, {:ok, msg}, state}

      {:error, reason} ->
        Logger.warning("Failed to send message: #{inspect(reason)}")
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:send_message, _text, _from}, _from_pid, state) do
    {:reply, {:error, :not_active}, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, Map.from_struct(state), state}
  end

  @impl true
  def handle_call(:auto_restart, _from, %{auto_restart_count: count} = state)
      when count >= @max_auto_restarts do
    Logger.warning(
      "Skipping auto-restart for #{state.agent_name}: reached max retries (#{@max_auto_restarts})"
    )

    {:reply, {:error, :max_retries}, state}
  end

  @impl true
  def handle_call(:auto_restart, from, state) do
    handle_call(:restart, from, %{state | auto_restart_count: state.auto_restart_count + 1})
  end

  @impl true
  def handle_call(:restart, _from, state) do
    kill_existing_runner(state.project_id, state.agent_id)

    # Re-fetch agent name from DB in case it was renamed
    agent_name =
      case Agents.get_agent(state.agent_id) do
        {:ok, agent} -> agent.name
        _ -> state.agent_name
      end

    state =
      %{state | command: nil, command_ref: nil, agent_name: agent_name}
      |> transition_status(:bootstrapping)

    Task.start_link(fn ->
      result = setup_agent_workspace(state.project_id, state.agent_id, state.agent_name)
      GenServer.cast(via(state.project_id, state.agent_id), {:bootstrap_complete, result})
    end)

    {:reply, :ok, state}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    state =
      Enum.reduce(lines, state, fn line, acc ->
        case parse_stdout_line(line) do
          {:ok,
           %{
             "type" => "agent_message_received",
             "payload" => %{"from_agent" => from_agent, "text" => text}
           }} ->
            Agents.create_message(%{
              project_id: acc.project_id,
              agent_id: acc.agent_id,
              role: "inter_agent",
              content: %{
                "text" => text,
                "from_agent" => from_agent,
                "to_agent" => acc.agent_name
              }
            })

            acc

          {:ok,
           %{
             "type" => "system_message_received",
             "payload" => %{"text" => text}
           }} ->
            case Agents.create_message(%{
                   project_id: acc.project_id,
                   agent_id: acc.agent_id,
                   role: "system",
                   content: %{"text" => text}
                 }) do
              {:ok, msg} ->
                event = %{
                  "type" => "system_message",
                  "payload" => %{"text" => text},
                  "message" => serialize_message(msg)
                }

                broadcast(acc, {:agent_event, acc.agent_id, event})

              {:error, _} ->
                :ok
            end

            acc

          {:ok, %{"type" => "spawn_agent", "payload" => %{"name" => new_name}}} ->
            # Look up agent by name to get ID
            case Agents.get_agent_by_name(acc.project_id, new_name) do
              %{id: agent_id} ->
                Shire.Agent.Coordinator.restart_agent(acc.project_id, agent_id)

              nil ->
                Logger.warning("spawn_agent: agent #{new_name} not found")
            end

            acc

          {:ok, %{"type" => "processing", "payload" => %{"active" => active}}} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{acc.project_id}:agents:lobby",
              {:agent_busy, acc.agent_id, active}
            )

            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{acc.project_id}:agent:#{acc.agent_id}",
              {:agent_busy, acc.agent_id, active}
            )

            acc

          {:ok, event} ->
            persist_and_broadcast(acc, event)

          :ignore ->
            acc

          {:error, _} ->
            Logger.warning("Unparseable stdout from #{acc.agent_name}: #{inspect(line)}")
            acc
        end
      end)

    {:noreply, %{state | buffer: buffer}}
  end

  # Agent runner exited
  @impl true
  def handle_info({:exit, %{ref: ref}, code}, %{command_ref: ref} = state) do
    Logger.warning("Agent runner for #{state.agent_name} exited with code #{code}")

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_status(:idle)

    {:noreply, state}
  end

  @impl true
  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Agent runner error for #{state.agent_name}: #{inspect(reason)}")

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_status(:idle)

    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("AgentManager #{state.agent_name} unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, %{project_id: project_id, agent_id: agent_id} = _state) do
    kill_existing_runner(project_id, agent_id)
    :ok
  end

  @impl true
  def handle_cast({:bootstrap_complete, :ok}, state) do
    {:noreply, state, {:continue, :spawn_runner}}
  end

  @impl true
  def handle_cast({:bootstrap_complete, {:error, e}}, state) do
    Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
    {:noreply, transition_status(state, :idle)}
  end

  # --- Private ---

  defp transition_status(state, status) do
    state = %{state | status: status}

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{state.project_id}:agent:#{state.agent_id}",
      {:status, status}
    )

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{state.project_id}:agents:lobby",
      {:agent_status, state.agent_id, status}
    )

    state
  end

  defp setup_agent_workspace(project_id, agent_id, agent_name) do
    agent_dir = "/workspace/agents/#{agent_id}"

    # Create agent directory structure
    for subdir <- ["inbox", "outbox", "scripts", "documents", ".claude/skills"] do
      @vm.cmd(project_id, "mkdir", ["-p", "#{agent_dir}/#{subdir}"], [])
    end

    # Read recipe to determine harness type
    recipe = read_recipe(project_id, agent_id)
    harness = recipe["harness"] || "claude_code"

    # Write comms instructions to the file the harness reads
    comms_file =
      case harness do
        "claude_code" -> "CLAUDE.md"
        _ -> "AGENTS.md"
      end

    @vm.write(project_id, "#{agent_dir}/#{comms_file}", comms_prompt(agent_name, agent_id))

    # Deploy skills from recipe
    deploy_skills(project_id, recipe, agent_dir)

    :ok
  rescue
    e ->
      Logger.error(
        "setup_agent_workspace failed: #{Exception.message(e)}\n#{Exception.format_stacktrace(__STACKTRACE__)}"
      )

      {:error, e}
  end

  defp read_recipe(project_id, agent_id) do
    path = "/workspace/agents/#{agent_id}/recipe.yaml"

    case @vm.cmd(project_id, "cat", [path], []) do
      {:ok, content} ->
        case YamlElixir.read_from_string(content) do
          {:ok, %{} = recipe} -> recipe
          _ -> %{}
        end

      {:error, _} ->
        %{}
    end
  end

  defp deploy_skills(project_id, %{"skills" => [_ | _] = skills} = recipe, agent_dir) do
    harness = recipe["harness"] || "claude_code"

    skill_base =
      case harness do
        "claude_code" -> "#{agent_dir}/.claude/skills"
        _ -> "#{agent_dir}/.pi/agent/skills"
      end

    # Clean stale skills from previous recipe versions
    @vm.cmd(project_id, "rm", ["-rf", skill_base], [])

    for skill <- skills do
      skill_dir = "#{skill_base}/#{skill["name"]}"
      @vm.cmd(project_id, "mkdir", ["-p", skill_dir], [])

      skill_md = build_skill_md(skill)
      @vm.write(project_id, "#{skill_dir}/SKILL.md", skill_md)

      for ref <- skill["references"] || [] do
        @vm.write(project_id, "#{skill_dir}/#{ref["name"]}", ref["content"])
      end
    end

    :ok
  end

  defp deploy_skills(_project_id, _recipe, _agent_dir), do: :ok

  defp build_skill_md(skill) do
    """
    ---
    name: #{skill["name"]}
    description: #{skill["description"]}
    ---

    #{skill["content"]}
    """
  end

  defp random_suffix do
    :crypto.strong_rand_bytes(4) |> Base.encode16(case: :lower)
  end

  defp kill_existing_runner(project_id, agent_id) do
    @vm.cmd(
      project_id,
      "pkill",
      ["-f", "agent-runner.ts --agent-dir /workspace/agents/#{agent_id}"],
      []
    )

    :ok
  end

  defp parse_stdout_line(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      :ignore
    else
      case Jason.decode(trimmed) do
        {:ok, %{"type" => _} = event} -> {:ok, event}
        {:ok, _} -> :ignore
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [rest]} = Enum.split(parts, -1)
    {complete, rest}
  end

  defp broadcast(state, message) do
    Phoenix.PubSub.broadcast(Shire.PubSub, state.pubsub_topic, message)
  end

  defp load_env_vars(project_id) do
    case @vm.cmd(project_id, "cat", ["/workspace/.env"], []) do
      {:ok, content} ->
        content
        |> String.split("\n", trim: true)
        |> Enum.reject(&String.starts_with?(String.trim(&1), "#"))
        |> Enum.map(fn line ->
          case String.split(line, "=", parts: 2) do
            [key, value] -> {String.trim(key), String.trim(value)}
            _ -> nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      {:error, _} ->
        []
    end
  end

  # --- Event persistence (persists once in AgentManager, broadcasts to LiveViews) ---

  defp persist_and_broadcast(state, %{"type" => "text_delta"} = event) do
    delta = get_in(event, ["payload", "delta"]) || ""
    state = %{state | streaming_text: (state.streaming_text || "") <> delta}
    broadcast(state, {:agent_event, state.agent_id, event})
    state
  end

  defp persist_and_broadcast(
         state,
         %{"type" => "tool_use", "payload" => %{"status" => "started"} = payload} = event
       ) do
    state = flush_and_broadcast_streaming(state)

    tool = Map.get(payload, "tool", "unknown")
    tool_use_id = Map.get(payload, "tool_use_id", "")
    input = Map.get(payload, "input", %{})

    case Agents.create_message(%{
           project_id: state.project_id,
           agent_id: state.agent_id,
           role: "tool_use",
           content: %{
             "tool" => tool,
             "tool_use_id" => tool_use_id,
             "input" => input,
             "output" => nil,
             "is_error" => false
           }
         }) do
      {:ok, msg} ->
        tool_use_ids = Map.put(state.tool_use_ids, tool_use_id, msg.id)
        enriched = put_in(event, ["message"], serialize_message(msg))
        broadcast(state, {:agent_event, state.agent_id, enriched})
        %{state | tool_use_ids: tool_use_ids}

      {:error, reason} ->
        Logger.warning("Failed to persist tool_use message: #{inspect(reason)}")
        broadcast(state, {:agent_event, state.agent_id, event})
        state
    end
  end

  defp persist_and_broadcast(
         state,
         %{"type" => "tool_use", "payload" => %{"status" => "input_ready"} = payload} = event
       ) do
    tool_use_id = Map.get(payload, "tool_use_id", "")
    input = Map.get(payload, "input", %{})

    case Map.get(state.tool_use_ids, tool_use_id) do
      nil ->
        state = flush_and_broadcast_streaming(state)
        tool = Map.get(payload, "tool", "unknown")

        case Agents.create_message(%{
               project_id: state.project_id,
               agent_id: state.agent_id,
               role: "tool_use",
               content: %{
                 "tool" => tool,
                 "tool_use_id" => tool_use_id,
                 "input" => input,
                 "output" => nil,
                 "is_error" => false
               }
             }) do
          {:ok, msg} ->
            tool_use_ids = Map.put(state.tool_use_ids, tool_use_id, msg.id)
            enriched = put_in(event, ["message"], serialize_message(msg))
            broadcast(state, {:agent_event, state.agent_id, enriched})
            %{state | tool_use_ids: tool_use_ids}

          {:error, _} ->
            broadcast(state, {:agent_event, state.agent_id, event})
            state
        end

      db_id ->
        db_msg = Agents.get_message!(db_id)
        Agents.update_message(db_msg, %{content: Map.merge(db_msg.content, %{"input" => input})})
        broadcast(state, {:agent_event, state.agent_id, event})
        state
    end
  end

  defp persist_and_broadcast(state, %{"type" => "tool_result", "payload" => payload} = event) do
    tool_use_id = Map.get(payload, "tool_use_id", "")
    output = Map.get(payload, "output", "")
    is_error = Map.get(payload, "is_error", false)

    case Map.get(state.tool_use_ids, tool_use_id) do
      nil ->
        :ok

      db_id ->
        db_msg = Agents.get_message!(db_id)

        Agents.update_message(db_msg, %{
          content: Map.merge(db_msg.content, %{"output" => output, "is_error" => is_error})
        })
    end

    broadcast(state, {:agent_event, state.agent_id, event})
    %{state | tool_use_ids: Map.delete(state.tool_use_ids, tool_use_id)}
  end

  defp persist_and_broadcast(state, %{"type" => "text", "payload" => %{"text" => text}} = event) do
    state = flush_and_broadcast_streaming(state)

    case Agents.create_message(%{
           project_id: state.project_id,
           agent_id: state.agent_id,
           role: "agent",
           content: %{"text" => text}
         }) do
      {:ok, msg} ->
        enriched = put_in(event, ["message"], serialize_message(msg))
        broadcast(state, {:agent_event, state.agent_id, enriched})

      {:error, _} ->
        broadcast(state, {:agent_event, state.agent_id, event})
    end

    state
  end

  defp persist_and_broadcast(state, %{"type" => "turn_complete"} = event) do
    state = flush_and_broadcast_streaming(state)
    broadcast(state, {:agent_event, state.agent_id, event})
    state
  end

  defp persist_and_broadcast(state, event) do
    broadcast(state, {:agent_event, state.agent_id, event})
    state
  end

  defp flush_and_broadcast_streaming(%{streaming_text: nil} = state), do: state

  defp flush_and_broadcast_streaming(%{streaming_text: ""} = state),
    do: %{state | streaming_text: nil}

  defp flush_and_broadcast_streaming(state) do
    case Agents.create_message(%{
           project_id: state.project_id,
           agent_id: state.agent_id,
           role: "agent",
           content: %{"text" => state.streaming_text}
         }) do
      {:ok, msg} ->
        flush_event = %{
          "type" => "text",
          "payload" => %{"text" => state.streaming_text},
          "message" => serialize_message(msg)
        }

        broadcast(state, {:agent_event, state.agent_id, flush_event})

      {:error, _} ->
        :ok
    end

    %{state | streaming_text: nil}
  end

  defp serialize_message(msg) do
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
end
