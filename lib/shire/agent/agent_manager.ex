defmodule Shire.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's lifecycle on the shared Sprite VM.
  One AgentManager per active agent. Receives the shared sprite reference
  from Coordinator — does not create its own VM.
  """
  use GenServer
  require Logger

  alias Shire.Agents

  @cmd_timeout 30_000

  defstruct [
    :agent_name,
    :sprite,
    :fs,
    :command,
    :command_ref,
    :pubsub_topic,
    phase: :idle,
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

  def get_state(server) do
    GenServer.call(server, :get_state, 60_000)
  end

  def get_sprite(agent_name) do
    GenServer.call(via(agent_name), :get_sprite, 60_000)
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
    sprite = Keyword.get(opts, :sprite)
    fs = Keyword.get(opts, :fs)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      agent_name: agent_name,
      sprite: sprite,
      fs: fs,
      pubsub_topic: "agent:#{agent_name}",
      phase: :idle
    }

    if skip_sprite do
      {:ok, state}
    else
      {:ok, state, {:continue, :bootstrap}}
    end
  end

  @impl true
  def handle_continue(:bootstrap, state) do
    state = transition_phase(state, :bootstrapping)

    Task.start_link(fn ->
      result = setup_agent_workspace(state)
      GenServer.cast(via(state.agent_name), {:bootstrap_complete, result})
    end)

    {:noreply, state}
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    agent_dir = "/workspace/agents/#{state.agent_name}"
    kill_existing_runner(state.sprite, state.agent_name)
    env = load_env_vars(state.sprite)

    case Sprites.spawn(
           state.sprite,
           "bun",
           ["run", "/workspace/.runner/agent-runner.ts", "--agent-dir", agent_dir],
           env: env,
           dir: agent_dir
         ) do
      {:ok, command} ->
        state =
          %{state | command: command, command_ref: command.ref}
          |> transition_phase(:active)

        {:noreply, state}

      {:error, reason} ->
        Logger.error("Failed to spawn agent runner for #{state.agent_name}: #{inspect(reason)}")
        {:noreply, transition_phase(state, :failed)}
    end
  end

  @impl true
  def handle_call({:send_message, text, from}, _from_pid, %{phase: :active} = state) do
    from_str =
      case from do
        :user -> "coordinator"
        {:agent, name} -> name
      end

    type =
      case from do
        :user -> "user_message"
        {:agent, _} -> "agent_message"
      end

    envelope = %{
      "ts" => System.system_time(:millisecond),
      "type" => type,
      "from" => from_str,
      "payload" => %{"text" => text}
    }

    inbox_dir = "/workspace/agents/#{state.agent_name}/mailbox/inbox"
    filename = "#{envelope["ts"]}-#{:rand.uniform(9999)}.json"

    case write_inbox_file(state.fs, "#{inbox_dir}/#{filename}", envelope) do
      :ok -> {:reply, :ok, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:send_message, _text, _from}, _from_pid, state) do
    {:reply, {:error, :not_active}, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, Map.from_struct(state), state}
  end

  @impl true
  def handle_call(:get_sprite, _from, state) do
    {:reply, {:ok, state.sprite}, state}
  end

  @impl true
  def handle_call(:restart, _from, %{sprite: sprite} = state) when not is_nil(sprite) do
    kill_existing_runner(sprite, state.agent_name)

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_phase(:bootstrapping)

    Task.start_link(fn ->
      result = setup_agent_workspace(state)
      GenServer.cast(via(state.agent_name), {:bootstrap_complete, result})
    end)

    {:reply, :ok, state}
  end

  def handle_call(:restart, _from, state) do
    {:reply, {:error, :no_sprite}, state}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    state =
      Enum.reduce(lines, state, fn line, acc ->
        case parse_stdout_line(line) do
          {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
            deliver_agent_message(acc, to, text)
            acc

          {:ok, %{"type" => "spawn_agent", "payload" => %{"name" => new_name}}} ->
            Shire.Agent.Coordinator.start_agent(new_name)
            acc

          {:ok, %{"type" => "processing", "payload" => %{"active" => active}}} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "agents:lobby",
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
      |> transition_phase(:failed)

    {:noreply, state}
  end

  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Agent runner error for #{state.agent_name}: #{inspect(reason)}")

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_phase(:failed)

    {:noreply, state}
  end

  def handle_info(msg, state) do
    Logger.debug("AgentManager #{state.agent_name} unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def handle_cast({:bootstrap_complete, :ok}, state) do
    {:noreply, state, {:continue, :spawn_runner}}
  end

  def handle_cast({:bootstrap_complete, {:error, e}}, state) do
    Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
    {:noreply, transition_phase(state, :failed)}
  end

  # --- Private ---

  defp transition_phase(state, phase) do
    state = %{state | phase: phase}
    Shire.Agent.Coordinator.notify_status(state.agent_name, phase)
    state
  end

  defp setup_agent_workspace(state) do
    agent_dir = "/workspace/agents/#{state.agent_name}"
    sprite = state.sprite
    fs = state.fs

    # Create agent directory structure
    for subdir <- ["mailbox/inbox", "scripts", "documents", ".claude/skills"] do
      Sprites.cmd(sprite, "mkdir", ["-p", "#{agent_dir}/#{subdir}"], timeout: @cmd_timeout)
    end

    # Write agent-config.json (read recipe.yaml to generate it)
    recipe = read_recipe(sprite, state.agent_name)
    config = build_agent_config(recipe)
    Sprites.Filesystem.write!(fs, "#{agent_dir}/agent-config.json", Jason.encode!(config))

    # Deploy skills from recipe
    deploy_skills(sprite, fs, recipe, agent_dir)

    :ok
  rescue
    e -> {:error, e}
  end

  defp read_recipe(sprite, agent_name) do
    path = "/workspace/agents/#{agent_name}/recipe.yaml"

    case Sprites.cmd(sprite, "cat", [path], timeout: @cmd_timeout) do
      {content, 0} ->
        case YamlElixir.read_from_string(content) do
          {:ok, recipe} -> recipe
          {:error, _} -> %{}
        end

      _ ->
        %{}
    end
  end

  defp build_agent_config(recipe) do
    %{
      "harness" => recipe["harness"] || "claude_code",
      "model" => recipe["model"] || "claude-sonnet-4-20250514",
      "system_prompt" => recipe["system_prompt"] || "",
      "max_tokens" => recipe["max_tokens"] || 16384
    }
  end

  defp deploy_skills(sprite, fs, recipe, agent_dir) do
    skills = recipe["skills"] || []
    if skills == [], do: :ok

    harness = recipe["harness"] || "claude_code"

    skill_base =
      case harness do
        "claude_code" -> "#{agent_dir}/.claude/skills"
        _ -> "#{agent_dir}/.pi/agent/skills"
      end

    # Clean stale skills from previous recipe versions
    Sprites.cmd(sprite, "rm", ["-rf", skill_base], timeout: @cmd_timeout)

    for skill <- skills do
      skill_dir = "#{skill_base}/#{skill["name"]}"
      Sprites.cmd(sprite, "mkdir", ["-p", skill_dir], timeout: @cmd_timeout)

      skill_md = build_skill_md(skill)
      Sprites.Filesystem.write!(fs, "#{skill_dir}/SKILL.md", skill_md)

      for ref <- skill["references"] || [] do
        Sprites.Filesystem.write!(fs, "#{skill_dir}/#{ref["name"]}", ref["content"])
      end
    end

    :ok
  end

  defp build_skill_md(skill) do
    """
    ---
    name: #{skill["name"]}
    description: #{skill["description"]}
    ---

    #{skill["content"]}
    """
  end

  defp deliver_agent_message(state, to_agent_name, text) do
    # Write directly to the target agent's inbox
    inbox_dir = "/workspace/agents/#{to_agent_name}/mailbox/inbox"

    envelope = %{
      "ts" => System.system_time(:millisecond),
      "type" => "agent_message",
      "from" => state.agent_name,
      "payload" => %{"text" => text}
    }

    filename = "#{envelope["ts"]}-#{:rand.uniform(9999)}.json"
    write_inbox_file(state.fs, "#{inbox_dir}/#{filename}", envelope)

    # Persist to DB for activity log
    Agents.create_message(%{
      agent_name: to_agent_name,
      role: "inter_agent",
      content: %{
        "text" => text,
        "from_agent" => state.agent_name,
        "to_agent" => to_agent_name
      }
    })
  end

  defp write_inbox_file(fs, path, envelope) do
    Sprites.Filesystem.write!(fs, path, Jason.encode!(envelope))
    :ok
  rescue
    e -> {:error, e}
  end

  defp kill_existing_runner(sprite, agent_name) do
    # Kill only this agent's runner process, not all runners on the shared VM
    Sprites.cmd(
      sprite,
      "pkill",
      ["-f", "agent-runner.ts --agent-dir /workspace/agents/#{agent_name}"],
      timeout: @cmd_timeout
    )
  rescue
    _ -> :ok
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

  defp load_env_vars(sprite) do
    case Sprites.cmd(sprite, "cat", ["/workspace/.env"]) do
      {content, 0} ->
        content
        |> String.split("\n", trim: true)
        |> Enum.map(fn line ->
          case String.split(line, "=", parts: 2) do
            [key, value] -> {key, value}
            _ -> nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
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
    state
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

  defp flush_and_broadcast_streaming(%{streaming_text: nil} = state), do: state

  defp flush_and_broadcast_streaming(%{streaming_text: ""} = state),
    do: %{state | streaming_text: nil}

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
