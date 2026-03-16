defmodule SpriteAgents.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's Sprite lifecycle.
  One AgentManager per active agent.
  """
  use GenServer
  require Logger

  alias SpriteAgents.{Agents, Mailbox}

  defstruct [
    :agent_id,
    :agent_name,
    :sprites_client,
    :sprite,
    :command,
    :command_ref,
    :pubsub_topic,
    phase: :idle,
    inbox_seq: 0,
    buffer: ""
  ]

  # --- Public API ---

  def start_link(opts) do
    agent = Keyword.fetch!(opts, :agent)
    GenServer.start_link(__MODULE__, opts, name: via(agent.name))
  end

  def send_message(name, text, from \\ :user) do
    GenServer.call(via(name), {:send_message, text, from})
  end

  def get_state(server) do
    GenServer.call(server, :get_state)
  end

  def stop(name) do
    GenServer.stop(via(name))
  end

  defp via(name) do
    {:via, Registry, {SpriteAgents.AgentRegistry, name}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent = Keyword.fetch!(opts, :agent)
    client = Keyword.get(opts, :sprites_client)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    state = %__MODULE__{
      agent_id: agent.id,
      agent_name: agent.name,
      sprites_client: client,
      pubsub_topic: "agent:#{agent.name}",
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
    state = %{state | phase: :starting}
    broadcast(state, {:status, :starting})

    sprite_name = "flyagents-#{state.agent_name}"

    case get_or_create_sprite(state.sprites_client, sprite_name) do
      {:ok, sprite} ->
        state = %{state | sprite: sprite, phase: :bootstrapping}
        broadcast(state, {:status, :bootstrapping})
        {:noreply, state, {:continue, :bootstrap}}

      {:error, reason} ->
        Logger.error("Failed to create sprite for #{state.agent_name}: #{inspect(reason)}")
        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_continue(:bootstrap, state) do
    sprite = state.sprite

    try do
      # Run bootstrap script
      bootstrap_script =
        File.read!(Application.app_dir(:sprite_agents, "priv/sprite/bootstrap.sh"))

      {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script])

      # Write agent config
      agent = Agents.get_agent!(state.agent_id)
      secrets = Agents.effective_secrets(state.agent_id)

      config =
        Jason.encode!(%{
          model: agent.model || "claude-sonnet-4-6",
          system_prompt: agent.system_prompt || "You are a helpful assistant.",
          max_tokens: 4096
        })

      fs = Sprites.filesystem(sprite)
      Sprites.Filesystem.write(fs, "/workspace/agent-config.json", config)

      # Write secrets as environment variables file
      env_content = Enum.map_join(secrets, "\n", fn s -> "#{s.key}=#{s.value}" end)
      Sprites.Filesystem.write(fs, "/workspace/.env", env_content)

      # Deploy agent-runner
      runner_source =
        File.read!(Application.app_dir(:sprite_agents, "priv/sprite/agent-runner.ts"))

      Sprites.Filesystem.write(fs, "/workspace/agent-runner.ts", runner_source)

      pkg_json = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/package.json"))
      Sprites.Filesystem.write(fs, "/workspace/package.json", pkg_json)

      # Install deps
      {_, 0} =
        Sprites.cmd(sprite, "bash", ["-c", "cd /workspace && bun install"], timeout: 60_000)

      {:noreply, state, {:continue, :spawn_runner}}
    rescue
      e ->
        Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
    end
  end

  @impl true
  def handle_continue(:spawn_runner, state) do
    env = load_env_vars(state.sprite)

    case Sprites.spawn(state.sprite, "bun", ["run", "/workspace/agent-runner.ts"],
           env: env,
           dir: "/workspace"
         ) do
      {:ok, command} ->
        state = %{state | command: command, command_ref: command.ref, phase: :active}
        broadcast(state, {:status, :active})
        update_agent_status(state, :active)
        {:noreply, state}

      {:error, reason} ->
        Logger.error("Failed to spawn agent runner for #{state.agent_name}: #{inspect(reason)}")

        state = %{state | phase: :failed}
        broadcast(state, {:status, :failed})
        update_agent_status(state, :failed)
        {:noreply, state}
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

    case Mailbox.write_inbox(state.sprite, type, %{text: text},
           from: from_str,
           seq: state.inbox_seq + 1
         ) do
      {:ok, seq} ->
        {:reply, :ok, %{state | inbox_seq: seq}}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:send_message, _text, _from}, _from_pid, state) do
    {:reply, {:error, :not_active}, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, Map.from_struct(state), state}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    Enum.each(lines, fn line ->
      case Mailbox.parse_stdout_line(line) do
        {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
          # Route inter-agent message via Coordinator
          SpriteAgents.Agent.Coordinator.route_agent_message(state.agent_name, to, text)

        {:ok, event} ->
          broadcast(state, {:agent_event, event})

        :ignore ->
          :ok

        {:error, _} ->
          Logger.warning("Unparseable stdout from #{state.agent_name}: #{inspect(line)}")
      end
    end)

    {:noreply, %{state | buffer: buffer}}
  end

  # Agent runner exited
  @impl true
  def handle_info({:exit, %{ref: ref}, code}, %{command_ref: ref} = state) do
    Logger.warning("Agent runner for #{state.agent_name} exited with code #{code}")
    state = %{state | phase: :failed, command: nil, command_ref: nil}
    broadcast(state, {:status, :failed})
    update_agent_status(state, :failed)
    {:noreply, state}
  end

  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Agent runner error for #{state.agent_name}: #{inspect(reason)}")
    {:noreply, state}
  end

  def handle_info(msg, state) do
    Logger.debug("AgentManager #{state.agent_name} unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # --- Private ---

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [rest]} = Enum.split(parts, -1)
    {complete, rest}
  end

  defp broadcast(state, message) do
    Phoenix.PubSub.broadcast(SpriteAgents.PubSub, state.pubsub_topic, message)
  end

  defp update_agent_status(state, status) do
    agent = Agents.get_agent!(state.agent_id)
    Agents.update_agent(agent, %{status: status})
  end

  defp get_or_create_sprite(client, name) do
    case Sprites.get_sprite(client, name) do
      {:ok, sprite} -> {:ok, sprite}
      {:error, :not_found} -> Sprites.create(client, name)
      {:error, reason} -> {:error, reason}
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
