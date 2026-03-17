defmodule Shire.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's Sprite lifecycle.
  One AgentManager per active agent.
  """
  use GenServer
  require Logger

  alias Shire.Agents

  @sprite_prefix Application.compile_env(:shire, :sprite_prefix, "agent")
  @cmd_timeout 30_000
  @ready_retries 6
  @ready_backoff 5_000

  defstruct [
    :agent_id,
    :agent_name,
    :sprites_client,
    :sprite,
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
    agent_id = Keyword.fetch!(opts, :agent_id)
    GenServer.start_link(__MODULE__, opts, name: via(agent_id, agent_name))
  end

  def send_message(agent_id, text, from \\ :user) do
    GenServer.call(via(agent_id), {:send_message, text, from}, 60_000)
  end

  def get_state(server) do
    GenServer.call(server, :get_state, 60_000)
  end

  def get_sprite(agent_id) do
    GenServer.call(via(agent_id), :get_sprite, 60_000)
  end

  def restart(agent_id) do
    GenServer.call(via(agent_id), :restart, 60_000)
  end

  defp via(agent_id) do
    {:via, Registry, {Shire.AgentRegistry, agent_id}}
  end

  defp via(agent_id, agent_name) do
    {:via, Registry, {Shire.AgentRegistry, agent_id, agent_name}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent_id = Keyword.fetch!(opts, :agent_id)
    agent_name = Keyword.fetch!(opts, :agent_name)
    client = Keyword.get(opts, :sprites_client)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      agent_id: agent_id,
      agent_name: agent_name,
      sprites_client: client,
      pubsub_topic: "agent:#{agent_id}",
      phase: :idle
    }

    if skip_sprite do
      {:ok, state}
    else
      {:ok, state, {:continue, :start_sprite}}
    end
  end

  @impl true
  def handle_continue(:start_sprite, state) do
    state = transition_phase(state, :starting)

    slug = state.agent_name |> String.downcase() |> String.replace(~r/[^a-z0-9-]/, "-")
    sprite_name = "#{@sprite_prefix}-#{slug}"

    case get_or_create_sprite(state.sprites_client, sprite_name) do
      {:ok, sprite} ->
        state = %{state | sprite: sprite} |> transition_phase(:bootstrapping)
        {:noreply, state, {:continue, :bootstrap}}

      {:error, reason} ->
        Logger.error("Failed to create sprite for #{state.agent_name}: #{inspect(reason)}")
        {:noreply, transition_phase(state, :failed)}
    end
  end

  @impl true
  def handle_continue(:bootstrap, state) do
    agent_id = state.agent_id
    sprite = state.sprite

    Task.start_link(fn ->
      result = run_bootstrap(agent_id, sprite)
      GenServer.cast(via(agent_id), {:bootstrap_complete, result})
    end)

    {:noreply, state}
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    kill_existing_runners(state.sprite)
    env = load_env_vars(state.sprite)

    case Sprites.spawn(state.sprite, "bun", ["run", "/workspace/.runner/agent-runner.ts"],
           env: env,
           dir: "/workspace"
         ) do
      {:ok, command} ->
        state =
          %{state | command: command, command_ref: command.ref}
          |> transition_phase(:active)

        Shire.Agent.Coordinator.request_peers(state.agent_id)
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

    # TODO: Phase 2 — reimplement inbox writing
    _ = {from_str, type, text}
    {:reply, :ok, state}
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
    kill_existing_runners(sprite)

    state =
      %{state | command: nil, command_ref: nil}
      |> transition_phase(:bootstrapping)

    agent_id = state.agent_id

    Task.start_link(fn ->
      result = run_bootstrap(agent_id, sprite)
      GenServer.cast(via(agent_id), {:bootstrap_complete, result})
    end)

    {:reply, :ok, state}
  end

  def handle_call(:restart, _from, %{sprite: nil} = state) do
    {:reply, :ok, state, {:continue, :start_sprite}}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    state =
      Enum.reduce(lines, state, fn line, acc ->
        case parse_stdout_line(line) do
          {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
            Shire.Agent.Coordinator.route_agent_message(acc.agent_name, to, text)
            acc

          {:ok, %{"type" => "processing", "payload" => %{"active" => active}}} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "agents:lobby",
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
    Shire.Agent.Coordinator.notify_status(state.agent_id, phase)
    state
  end

  defp run_bootstrap(_agent_id, sprite) do
    wait_for_ready(sprite)
    run_bootstrap_script(sprite)
    # TODO: Phase 2 — reimplement recipe deployment, config, skills, runtime files
    :ok
  rescue
    e -> {:error, e}
  end

  defp run_bootstrap_script(sprite) do
    bootstrap_script =
      File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script], timeout: 120_000)
  end

  defp kill_existing_runners(sprite) do
    Sprites.cmd(sprite, "pkill", ["-f", "agent-runner"], timeout: @cmd_timeout)
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

  defp get_or_create_sprite(client, name) do
    case Sprites.get_sprite(client, name) do
      {:ok, _info} -> {:ok, Sprites.sprite(client, name)}
      {:error, {:not_found, _}} -> Sprites.create(client, name)
      {:error, reason} -> {:error, reason}
    end
  end

  defp wait_for_ready(sprite, attempt \\ 1) do
    Sprites.cmd(sprite, "echo", ["ready"], timeout: 10_000)
    :ok
  rescue
    e ->
      if attempt < @ready_retries do
        Logger.info(
          "Sprite not ready (attempt #{attempt}/#{@ready_retries}), retrying in #{@ready_backoff}ms..."
        )

        Process.sleep(@ready_backoff)
        wait_for_ready(sprite, attempt + 1)
      else
        raise e
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
    # Flush accumulated streaming text first
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
        # No matching tool_use found — create a new one
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
end
