defmodule SpriteAgents.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's Sprite lifecycle.
  One AgentManager per active agent.
  """
  use GenServer
  require Logger

  alias SpriteAgents.Agent.{DriveSync, SpriteHelpers}
  alias SpriteAgents.{Agents, Mailbox}

  @comms_prompt """
  ## Inter-Agent Communication

  You are one of several agents running in a shared environment. You can collaborate with other agents.

  ### First Responder Rule
  When the user sends you a message, YOU are the lead for that task. This means:
  - You are responsible for delivering the final result to the user
  - If the task needs capabilities other agents have, delegate to them via outbox messages
  - When you receive replies from other agents, synthesize their input and present the final answer
  - Never leave the user without a response — acknowledge the task, delegate if needed, then follow up with the result
  - The user sees YOUR output, not the other agents' — so always produce the complete final response

  ### Discovering Peers
  Read `/workspace/peers.json` to see which other agents are currently running. Each entry has:
  - `name`: the agent's identifier (use this in messages)
  - `description`: what the agent does

  This file is updated automatically when agents start or stop.

  ### Sending Messages
  To send a message to another agent, write a JSON file to `/workspace/mailbox/outbox/`:

  File: `/workspace/mailbox/outbox/<anything>.json`
  Format: {"to": "<agent-name>", "text": "<your message>"}

  The message will be delivered to the other agent automatically and the file will be cleaned up.

  ### Receiving Messages
  Messages from other agents arrive in your normal conversation flow, prefixed with [Message from agent "<name>"].
  If you are the lead (user messaged you), incorporate the agent's reply into your final response to the user.
  If another agent asked you for help, send your result back via a new outbox message.

  ### Guidelines
  - Check peers.json before messaging to confirm the agent exists
  - Be specific about what you need from the other agent
  - Don't send messages unnecessarily — only when collaboration genuinely helps the task

  ## Shared Drive

  All agents share a drive mounted at `/workspace/shared/`. Files you write here are automatically synced to all other running agents, and their writes appear here too.

  ### Usage
  - Read/write files normally in `/workspace/shared/`
  - Changes sync automatically — no special protocol needed
  - Use it for project files, documentation, research, build artifacts, or any shared data
  - Avoid rapid sequential writes to the same file — batch your changes when possible
  - If a file changed unexpectedly, another agent may have updated it — re-read before overwriting
  - Maximum file size: 1MB per file
  """

  @cmd_timeout 30_000

  defstruct [
    :agent_id,
    :agent_name,
    :sprites_client,
    :sprite,
    :command,
    :command_ref,
    :pubsub_topic,
    phase: :idle,
    buffer: ""
  ]

  # --- Public API ---

  alias SpriteAgents.Agents.Agent

  def start_link(opts) do
    agent = Keyword.fetch!(opts, :agent)
    recipe = Agent.parse_recipe!(agent)
    agent_name = recipe["name"] || "agent-#{agent.id}"
    GenServer.start_link(__MODULE__, opts, name: via(agent.id, agent_name))
  end

  def send_message(agent_id, text, from \\ :user) do
    GenServer.call(via(agent_id), {:send_message, text, from})
  end

  def get_state(server) do
    GenServer.call(server, :get_state)
  end

  def get_sprite(agent_id) do
    GenServer.call(via(agent_id), :get_sprite)
  end

  def stop(agent_id) do
    GenServer.stop(via(agent_id))
  end

  defp via(agent_id) do
    {:via, Registry, {SpriteAgents.AgentRegistry, agent_id}}
  end

  defp via(agent_id, agent_name) do
    {:via, Registry, {SpriteAgents.AgentRegistry, agent_id, agent_name}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent = Keyword.fetch!(opts, :agent)
    client = Keyword.get(opts, :sprites_client)
    skip_sprite = Keyword.get(opts, :skip_sprite, false)

    recipe = Agent.parse_recipe!(agent)
    agent_name = recipe["name"] || "agent-#{agent.id}"

    state = %__MODULE__{
      agent_id: agent.id,
      agent_name: agent_name,
      sprites_client: client,
      pubsub_topic: "agent:#{agent.id}",
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
    update_agent_status(state, :starting)

    slug = state.agent_name |> String.downcase() |> String.replace(~r/[^a-z0-9-]/, "-")
    sprite_name = "flyagents-#{slug}"

    case get_or_create_sprite(state.sprites_client, sprite_name) do
      {:ok, sprite} ->
        state = %{state | sprite: sprite, phase: :bootstrapping}
        broadcast(state, {:status, :bootstrapping})
        update_agent_status(state, :bootstrapping)
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

    case Sprites.spawn(state.sprite, "bun", ["run", "/workspace/agent-runner.ts"],
           env: env,
           dir: "/workspace"
         ) do
      {:ok, command} ->
        state = %{state | command: command, command_ref: command.ref, phase: :active}
        broadcast(state, {:status, :active})
        update_agent_status(state, :active)
        SpriteAgents.Agent.Coordinator.request_peers(state.agent_id)
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

    case Mailbox.write_inbox(state.sprite, type, %{text: text}, from: from_str) do
      :ok ->
        {:reply, :ok, state}

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

  @impl true
  def handle_call(:get_sprite, _from, state) do
    {:reply, {:ok, state.sprite}, state}
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

        {:ok, %{"type" => "drive_write", "payload" => %{"path" => path, "content" => content}}} ->
          DriveSync.file_changed(state.agent_id, path, Base.decode64!(content))

        {:ok, %{"type" => "drive_delete", "payload" => %{"path" => path}}} ->
          DriveSync.file_deleted(state.agent_id, path)

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

  @impl true
  def handle_cast({:bootstrap_complete, :ok}, state) do
    {:noreply, state, {:continue, :spawn_runner}}
  end

  def handle_cast({:bootstrap_complete, {:error, e}}, state) do
    Logger.error("Bootstrap failed for #{state.agent_name}: #{inspect(e)}")
    state = %{state | phase: :failed}
    broadcast(state, {:status, :failed})
    update_agent_status(state, :failed)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:update_peers, peers}, %{phase: :active, sprite: sprite} = state)
      when not is_nil(sprite) do
    try do
      fs = SpriteHelpers.filesystem(sprite)
      :ok = Sprites.Filesystem.write(fs, "/workspace/peers.json", Jason.encode!(peers))
    rescue
      e ->
        Logger.warning("Failed to write peers.json for #{state.agent_name}: #{inspect(e)}")
    end

    {:noreply, state}
  end

  def handle_cast({:update_peers, _peers}, state) do
    {:noreply, state}
  end

  # Incoming shared drive file sync from DriveSync
  def handle_cast({:drive_sync, path, content}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    try do
      # Atomic write: marker + file in single cmd to prevent echo loop
      safe_path = String.replace(path, "'", "'\\''")

      Sprites.cmd(
        sprite,
        "bash",
        [
          "-c",
          "mkdir -p /workspace/.drive-sync/$(dirname '#{safe_path}') && " <>
            "touch '/workspace/.drive-sync/#{safe_path}' && " <>
            "mkdir -p $(dirname '/workspace/shared/#{safe_path}') && " <>
            "cat > '/workspace/shared/#{safe_path}'"
        ],
        stdin: content,
        timeout: @cmd_timeout
      )
    rescue
      e ->
        Logger.warning("Failed to sync drive file #{path} to #{state.agent_name}: #{inspect(e)}")
    end

    {:noreply, state}
  end

  def handle_cast({:drive_delete, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    try do
      safe_path = String.replace(path, "'", "'\\''")

      Sprites.cmd(
        sprite,
        "bash",
        [
          "-c",
          "mkdir -p /workspace/.drive-sync/$(dirname '#{safe_path}') && " <>
            "touch '/workspace/.drive-sync/#{safe_path}' && " <>
            "rm -f '/workspace/shared/#{safe_path}'"
        ],
        timeout: @cmd_timeout
      )
    rescue
      e ->
        Logger.warning(
          "Failed to delete drive file #{path} from #{state.agent_name}: #{inspect(e)}"
        )
    end

    {:noreply, state}
  end

  def handle_cast({:drive_create_dir, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    try do
      safe_path = String.replace(path, "'", "'\\''")

      Sprites.cmd(sprite, "mkdir", ["-p", "/workspace/shared/#{safe_path}"],
        timeout: @cmd_timeout
      )
    rescue
      e ->
        Logger.warning("Failed to create drive dir #{path} on #{state.agent_name}: #{inspect(e)}")
    end

    {:noreply, state}
  end

  def handle_cast({:drive_delete_dir, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    try do
      safe_path = String.replace(path, "'", "'\\''")
      Sprites.cmd(sprite, "rm", ["-rf", "/workspace/shared/#{safe_path}"], timeout: @cmd_timeout)
    rescue
      e ->
        Logger.warning("Failed to delete drive dir #{path} on #{state.agent_name}: #{inspect(e)}")
    end

    {:noreply, state}
  end

  # Catch-all for casts when sprite is nil
  def handle_cast({drive_op, _args}, state)
      when drive_op in [:drive_sync, :drive_delete, :drive_create_dir, :drive_delete_dir] do
    {:noreply, state}
  end

  def handle_cast({drive_op, _path, _content}, state)
      when drive_op in [:drive_sync] do
    {:noreply, state}
  end

  # --- Private ---

  defp run_bootstrap(agent_id, sprite) do
    bootstrap_script =
      File.read!(Application.app_dir(:sprite_agents, "priv/sprite/bootstrap.sh"))

    {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script], timeout: 120_000)

    agent = Agents.get_agent!(agent_id)
    recipe = Agent.parse_recipe!(agent)
    secrets = Agents.effective_secrets(agent_id)

    harness = recipe["harness"] || "pi"

    default_model =
      case harness do
        "claude_code" -> "claude-sonnet-4-6"
        _ -> "anthropic/claude-sonnet-4-6"
      end

    system_prompt =
      (recipe["system_prompt"] || "You are a helpful assistant.") <> "\n\n" <> @comms_prompt

    config =
      Jason.encode!(%{
        harness: harness,
        model: recipe["model"] || default_model,
        system_prompt: system_prompt,
        max_tokens: 4096
      })

    fs = SpriteHelpers.filesystem(sprite)
    :ok = Sprites.Filesystem.write(fs, "/workspace/agent-config.json", config)
    :ok = Sprites.Filesystem.write(fs, "/workspace/peers.json", "[]")

    recipe_json = Jason.encode!(recipe)
    :ok = Sprites.Filesystem.write(fs, "/workspace/recipe.json", recipe_json)

    env_content = Enum.map_join(secrets, "\n", fn s -> "#{s.key}=#{s.value}" end)
    :ok = Sprites.Filesystem.write(fs, "/workspace/.env", env_content)

    deploy_skills(sprite, fs, recipe, harness)

    ts_files = [
      "agent-runner.ts",
      "harness/types.ts",
      "harness/pi-harness.ts",
      "harness/claude-code-harness.ts",
      "harness/index.ts"
    ]

    for file <- ts_files do
      source = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/#{file}"))
      :ok = Sprites.Filesystem.write(fs, "/workspace/#{file}", source)
    end

    recipe_runner =
      File.read!(Application.app_dir(:sprite_agents, "priv/sprite/recipe-runner.ts"))

    :ok = Sprites.Filesystem.write(fs, "/workspace/recipe-runner.ts", recipe_runner)

    pkg_json = File.read!(Application.app_dir(:sprite_agents, "priv/sprite/package.json"))
    :ok = Sprites.Filesystem.write(fs, "/workspace/package.json", pkg_json)

    if recipe["scripts"] && recipe["scripts"] != [] do
      Sprites.cmd(sprite, "bun", ["run", "/workspace/recipe-runner.ts"], timeout: 300_000)
    end

    {_, 0} =
      Sprites.cmd(sprite, "bash", ["-c", "cd /workspace && bun install"], timeout: 60_000)

    DriveSync.ensure_started()
    DriveSync.sync_to_agent(agent_id, sprite)

    :ok
  rescue
    e -> {:error, e}
  end

  defp deploy_skills(sprite, fs, recipe, harness) do
    skills = recipe["skills"] || []

    if skills == [] do
      :ok
    else
      deploy_skills_to_vm(sprite, fs, skills, harness)
    end
  end

  defp deploy_skills_to_vm(sprite, fs, skills, harness) do
    skill_base =
      case harness do
        "claude_code" -> "/workspace/.claude/skills"
        _ -> "/workspace/.pi/agent/skills"
      end

    # Clean stale skills from previous recipe versions
    Sprites.cmd(sprite, "rm", ["-rf", skill_base], timeout: @cmd_timeout)

    for skill <- skills do
      skill_dir = "#{skill_base}/#{skill["name"]}"
      Sprites.cmd(sprite, "mkdir", ["-p", skill_dir], timeout: @cmd_timeout)

      skill_md = build_skill_md(skill)
      :ok = Sprites.Filesystem.write(fs, "#{skill_dir}/SKILL.md", skill_md)

      for ref <- skill["references"] || [] do
        :ok = Sprites.Filesystem.write(fs, "#{skill_dir}/#{ref["name"]}", ref["content"])
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

  defp kill_existing_runners(sprite) do
    Sprites.cmd(sprite, "pkill", ["-f", "agent-runner"], timeout: @cmd_timeout)
  rescue
    _ -> :ok
  end

  defp split_lines(data) do
    parts = String.split(data, "\n")
    {complete, [rest]} = Enum.split(parts, -1)
    {complete, rest}
  end

  defp broadcast(state, message) do
    Phoenix.PubSub.broadcast(SpriteAgents.PubSub, state.pubsub_topic, message)
  end

  defp update_agent_status(state, status) do
    case Agents.get_agent(state.agent_id) do
      {:ok, agent} ->
        Agents.update_agent_status(agent, status)

      {:error, :not_found} ->
        Logger.warning("Agent #{state.agent_id} deleted, skipping status update to #{status}")
    end
  end

  defp get_or_create_sprite(client, name) do
    case Sprites.get_sprite(client, name) do
      {:ok, _info} -> {:ok, Sprites.sprite(client, name)}
      {:error, {:not_found, _}} -> Sprites.create(client, name)
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
