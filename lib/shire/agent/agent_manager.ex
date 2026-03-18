defmodule Shire.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's lifecycle on the shared Sprite VM.
  One AgentManager per active agent. Uses Shire.VirtualMachine for all
  VM operations — does not hold sprite/fs references.
  """
  use GenServer
  require Logger

  alias Shire.Agents
  alias Shire.Constants

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  defp comms_prompt(agent_name) do
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
    List `/workspace/agents/` to see other agents. Each subdirectory is an agent.
    Read their `recipe.yaml` to see what they do.

    ## Sending Messages
    To message another agent, write a JSON file to your **outbox**:

    **Path:** `/workspace/agents/#{agent_name}/outbox/<timestamp>.json`

    **Format:**
    ```json
    {
      "to": "<target-agent-name>",
      "text": "<your message>"
    }
    ```

    Example using Bash:
    ```bash
    echo '{"to":"target-agent","text":"Hello, can you help me with X?"}' > /workspace/agents/#{agent_name}/outbox/$(date +%s%3N)-$RANDOM.json
    ```

    The system picks up the message and delivers it to the target agent automatically.

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
    - List `/workspace/agents/` before messaging to confirm the target agent exists
    - Be specific about what you need from the other agent
    - Don't send messages unnecessarily — only when collaboration genuinely helps
    """
  end

  @outbox_poll_interval 2_000
  # 15 minutes (matches Constants.idle_threshold_ms/0)
  @idle_threshold_ms 900_000

  defstruct [
    :agent_name,
    :command,
    :command_ref,
    :pubsub_topic,
    :outbox_timer,
    :last_activity,
    status: :idle,
    buffer: "",
    streaming_text: nil,
    tool_use_ids: %{}
  ]

  # --- Public API ---

  def start_link(opts) do
    agent_name = Keyword.fetch!(opts, :agent_name)
    GenServer.start_link(__MODULE__, opts, name: via(agent_name))
  end

  def send_message(agent_name, text, from \\ :user) do
    GenServer.call(via(agent_name), {:send_message, text, from}, 60_000)
  end

  @spec get_state(atom() | pid() | {atom(), any()} | {:via, atom(), any()}) :: any()
  def get_state(server) do
    GenServer.call(server, :get_state, 60_000)
  end

  def restart(agent_name) do
    GenServer.call(via(agent_name), :restart, 60_000)
  end

  defp via(agent_name) do
    {:via, Registry, {Shire.AgentRegistry, agent_name, agent_name}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent_name = Keyword.fetch!(opts, :agent_name)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      agent_name: agent_name,
      pubsub_topic: "agent:#{agent_name}",
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
      result = setup_agent_workspace(state.agent_name)
      GenServer.cast(via(state.agent_name), {:bootstrap_complete, result})
    end)

    {:noreply, state}
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    agent_dir = "#{Constants.agents_dir()}/#{state.agent_name}"
    kill_existing_runner(state.agent_name)
    env = load_env_vars()

    case @vm.spawn_command(
           "bun",
           ["run", "/workspace/.runner/agent-runner.ts", "--agent-dir", agent_dir],
           env: env,
           dir: agent_dir
         ) do
      {:ok, command} ->
        state =
          %{state | command: command, command_ref: command.ref}
          |> transition_status(:active)

        {:noreply, state}

      {:error, reason} ->
        Logger.error("Failed to spawn agent runner for #{state.agent_name}: #{inspect(reason)}")
        {:noreply, transition_status(state, :failed)}
    end
  end

  @impl true
  def handle_call({:send_message, text, from}, _from_pid, %{status: :active} = state) do
    {type, from_str} =
      case from do
        :user -> {"user_message", "user"}
        {:agent, name} -> {"agent_message", name}
      end

    envelope = %{
      "ts" => System.system_time(:millisecond),
      "type" => type,
      "from" => from_str,
      "payload" => %{"text" => text}
    }

    inbox_dir = "#{Constants.agents_dir()}/#{state.agent_name}/inbox"
    filename = "#{envelope["ts"]}-#{random_suffix()}.json"

    state = %{state | last_activity: System.monotonic_time(:millisecond)}

    case write_inbox_file("#{inbox_dir}/#{filename}", envelope) do
      :ok ->
        case from do
          :user ->
            case Agents.create_message(%{
                   agent_name: state.agent_name,
                   role: "user",
                   content: %{"text" => text}
                 }) do
              {:ok, msg} ->
                {:reply, {:ok, msg}, state}

              {:error, reason} ->
                Logger.warning("Failed to persist user message: #{inspect(reason)}")
                {:reply, :ok, state}
            end

          {:agent, from_name} ->
            Agents.create_message(%{
              agent_name: state.agent_name,
              role: "inter_agent",
              content: %{
                "text" => text,
                "from_agent" => from_name,
                "to_agent" => state.agent_name
              }
            })

            {:reply, :ok, state}
        end

      {:error, reason} ->
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
  def handle_call(:restart, _from, state) do
    kill_existing_runner(state.agent_name)

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_status(:bootstrapping)

    Task.start_link(fn ->
      result = setup_agent_workspace(state.agent_name)
      GenServer.cast(via(state.agent_name), {:bootstrap_complete, result})
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
          {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
            __MODULE__.send_message(to, text, {:agent, acc.agent_name})
            acc

          {:ok, %{"type" => "spawn_agent", "payload" => %{"name" => new_name}}} ->
            Shire.Agent.Coordinator.restart_agent(new_name)
            acc

          {:ok, %{"type" => "processing", "payload" => %{"active" => active}}} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "agents:lobby",
              {:agent_busy, acc.agent_name, active}
            )

            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "agent:#{acc.agent_name}",
              {:agent_busy, acc.agent_name, active}
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
      |> transition_status(:failed)

    {:noreply, state}
  end

  @impl true
  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Agent runner error for #{state.agent_name}: #{inspect(reason)}")

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_status(:failed)

    {:noreply, state}
  end

  # Host-side outbox polling — reads agent's outbox via VM filesystem API
  # and routes messages to target agents. This bypasses unreliable intra-VM
  # file detection (fs.watch/polling don't work for files written by child processes).
  @impl true
  def handle_info(:poll_outbox, %{status: :active} = state) do
    idle? =
      state.last_activity == nil or
        System.monotonic_time(:millisecond) - state.last_activity >= @idle_threshold_ms

    if idle? do
      {:noreply, %{state | outbox_timer: schedule_outbox_poll()}}
    else
      outbox_dir = "#{Constants.agents_dir()}/#{state.agent_name}/outbox"

      case @vm.ls(outbox_dir) do
        {:ok, entries} ->
          (entries || [])
          |> Enum.filter(&String.ends_with?(&1["name"] || "", ".json"))
          |> Enum.sort_by(& &1["name"])
          |> Enum.each(fn entry ->
            path = "#{outbox_dir}/#{entry["name"]}"

            case @vm.read(path) do
              {:ok, content} ->
                sanitized = Regex.replace(~r/\\([^"\\\/bfnrtu])/, content, "\\1")

                case Jason.decode(sanitized) do
                  {:ok, %{"to" => to, "text" => text}} ->
                    try do
                      __MODULE__.send_message(to, text, {:agent, state.agent_name})
                    catch
                      :exit, reason ->
                        Logger.warning(
                          "Failed to deliver outbox message to #{to}: #{inspect(reason)}"
                        )
                    end

                    @vm.rm(path)

                  other ->
                    Logger.warning("Invalid outbox message in #{path}: #{inspect(other)}")
                    @vm.rm(path)
                end

              {:error, reason} ->
                Logger.warning("Failed to read outbox file #{path}: #{inspect(reason)}")
            end
          end)

        {:error, _} ->
          :ok
      end

      {:noreply, %{state | outbox_timer: schedule_outbox_poll()}}
    end
  end

  def handle_info(:poll_outbox, state) do
    {:noreply, %{state | outbox_timer: nil}}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("AgentManager #{state.agent_name} unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, %{agent_name: agent_name} = _state) do
    kill_existing_runner(agent_name)
    :ok
  end

  @impl true
  def handle_cast({:bootstrap_complete, :ok}, state) do
    {:noreply, state, {:continue, :spawn_runner}}
  end

  @impl true
  def handle_cast({:bootstrap_complete, {:error, e}}, state) do
    Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
    {:noreply, transition_status(state, :failed)}
  end

  # --- Private ---

  defp transition_status(state, status) do
    state =
      if state.outbox_timer do
        Process.cancel_timer(state.outbox_timer)
        %{state | outbox_timer: nil}
      else
        state
      end

    state =
      if status == :active do
        %{state | outbox_timer: schedule_outbox_poll()}
      else
        state
      end

    state = %{state | status: status}

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agent:#{state.agent_name}",
      {:status, status}
    )

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agents:lobby",
      {:agent_status, state.agent_name, status}
    )

    state
  end

  defp schedule_outbox_poll do
    Process.send_after(self(), :poll_outbox, @outbox_poll_interval)
  end

  defp setup_agent_workspace(agent_name) do
    agent_dir = "#{Constants.agents_dir()}/#{agent_name}"

    # Create agent directory structure
    for subdir <- ["inbox", "outbox", "scripts", "documents", ".claude/skills"] do
      @vm.cmd("mkdir", ["-p", "#{agent_dir}/#{subdir}"], [])
    end

    # Read recipe to determine harness type
    recipe = read_recipe(agent_name)
    harness = recipe["harness"] || "claude_code"

    # Write comms instructions to the file the harness reads
    comms_file =
      case harness do
        "claude_code" -> "CLAUDE.md"
        _ -> "AGENTS.md"
      end

    @vm.write("#{agent_dir}/#{comms_file}", comms_prompt(agent_name))

    # Deploy skills from recipe
    deploy_skills(recipe, agent_dir)

    :ok
  rescue
    e ->
      Logger.error(
        "setup_agent_workspace failed: #{Exception.message(e)}\n#{Exception.format_stacktrace(__STACKTRACE__)}"
      )

      {:error, e}
  end

  defp read_recipe(agent_name) do
    path = "#{Constants.agents_dir()}/#{agent_name}/recipe.yaml"

    case @vm.cmd("cat", [path], []) do
      {:ok, content} ->
        case YamlElixir.read_from_string(content) do
          {:ok, %{} = recipe} -> recipe
          _ -> %{}
        end

      {:error, _} ->
        %{}
    end
  end

  defp deploy_skills(%{"skills" => [_ | _] = skills} = recipe, agent_dir) do
    harness = recipe["harness"] || "claude_code"

    skill_base =
      case harness do
        "claude_code" -> "#{agent_dir}/.claude/skills"
        _ -> "#{agent_dir}/.pi/agent/skills"
      end

    # Clean stale skills from previous recipe versions
    @vm.cmd("rm", ["-rf", skill_base], [])

    for skill <- skills do
      skill_dir = "#{skill_base}/#{skill["name"]}"
      @vm.cmd("mkdir", ["-p", skill_dir], [])

      skill_md = build_skill_md(skill)
      @vm.write("#{skill_dir}/SKILL.md", skill_md)

      for ref <- skill["references"] || [] do
        @vm.write("#{skill_dir}/#{ref["name"]}", ref["content"])
      end
    end

    :ok
  end

  defp deploy_skills(_recipe, _agent_dir), do: :ok

  defp build_skill_md(skill) do
    """
    ---
    name: #{skill["name"]}
    description: #{skill["description"]}
    ---

    #{skill["content"]}
    """
  end

  defp write_inbox_file(path, envelope) do
    @vm.write(path, Jason.encode!(envelope))
  end

  defp random_suffix do
    :crypto.strong_rand_bytes(4) |> Base.encode16(case: :lower)
  end

  defp kill_existing_runner(agent_name) do
    # Kill only this agent's runner process, not all runners on the shared VM
    @vm.cmd(
      "pkill",
      ["-f", "agent-runner.ts --agent-dir #{Constants.agents_dir()}/#{agent_name}"],
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

  defp load_env_vars do
    case @vm.cmd("cat", [Constants.env_file()], []) do
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
    broadcast(state, {:agent_event, state.agent_name, event})
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
           agent_name: state.agent_name,
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
        broadcast(state, {:agent_event, state.agent_name, enriched})
        %{state | tool_use_ids: tool_use_ids}

      {:error, reason} ->
        Logger.warning("Failed to persist tool_use message: #{inspect(reason)}")
        broadcast(state, {:agent_event, state.agent_name, event})
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
               agent_name: state.agent_name,
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
            broadcast(state, {:agent_event, state.agent_name, enriched})
            %{state | tool_use_ids: tool_use_ids}

          {:error, _} ->
            broadcast(state, {:agent_event, state.agent_name, event})
            state
        end

      db_id ->
        db_msg = Agents.get_message!(db_id)
        Agents.update_message(db_msg, %{content: Map.merge(db_msg.content, %{"input" => input})})
        broadcast(state, {:agent_event, state.agent_name, event})
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

    broadcast(state, {:agent_event, state.agent_name, event})
    %{state | tool_use_ids: Map.delete(state.tool_use_ids, tool_use_id)}
  end

  defp persist_and_broadcast(state, %{"type" => "text", "payload" => %{"text" => text}} = event) do
    state = flush_and_broadcast_streaming(state)

    case Agents.create_message(%{
           agent_name: state.agent_name,
           role: "agent",
           content: %{"text" => text}
         }) do
      {:ok, msg} ->
        enriched = put_in(event, ["message"], serialize_message(msg))
        broadcast(state, {:agent_event, state.agent_name, enriched})

      {:error, _} ->
        broadcast(state, {:agent_event, state.agent_name, event})
    end

    state
  end

  defp persist_and_broadcast(state, %{"type" => "turn_complete"} = event) do
    state = flush_and_broadcast_streaming(state)
    broadcast(state, {:agent_event, state.agent_name, event})
    state
  end

  defp persist_and_broadcast(state, event) do
    broadcast(state, {:agent_event, state.agent_name, event})
    state
  end

  defp flush_and_broadcast_streaming(%{streaming_text: text} = state)
       when is_nil(text) or text == "" do
    %{state | streaming_text: nil}
  end

  defp flush_and_broadcast_streaming(state) do
    case Agents.create_message(%{
           agent_name: state.agent_name,
           role: "agent",
           content: %{"text" => state.streaming_text}
         }) do
      {:ok, msg} ->
        flush_event = %{
          "type" => "text",
          "payload" => %{"text" => state.streaming_text},
          "message" => serialize_message(msg)
        }

        broadcast(state, {:agent_event, state.agent_name, flush_event})

      {:error, _} ->
        :ok
    end

    %{state | streaming_text: nil}
  end

  defp serialize_message(msg) do
    Shire.Agents.Message.serialize(msg)
  end
end
