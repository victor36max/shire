defmodule Shire.Agent.AgentManager do
  @moduledoc """
  GenServer managing a single agent's Sprite lifecycle.
  One AgentManager per active agent.
  """
  use GenServer
  require Logger

  alias Shire.Agent.{DriveSync, SpriteHelpers}
  alias Shire.{Agents, Mailbox}

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

  alias Shire.Agents.Agent

  def start_link(opts) do
    agent = Keyword.fetch!(opts, :agent)
    recipe = Agent.parse_recipe!(agent)
    agent_name = recipe["name"] || "agent-#{agent.id}"
    GenServer.start_link(__MODULE__, opts, name: via(agent.id, agent_name))
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

    case Sprites.spawn(state.sprite, "bun", ["run", "/workspace/agent-runner.ts"],
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

  def handle_call(:restart, _from, state) do
    {:reply, {:error, :no_sprite}, state}
  end

  # Process stdout from agent runner (JSONL lines)
  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    {lines, buffer} = split_lines(state.buffer <> data)

    state =
      Enum.reduce(lines, state, fn line, acc ->
        case Mailbox.parse_stdout_line(line) do
          {:ok, %{"type" => "agent_message", "payload" => %{"to_agent" => to, "text" => text}}} ->
            Shire.Agent.Coordinator.route_agent_message(acc.agent_name, to, text)
            acc

          {:ok, %{"type" => "drive_write", "payload" => %{"path" => path, "content" => content}}} ->
            DriveSync.file_changed(acc.agent_id, path, Base.decode64!(content))
            acc

          {:ok, %{"type" => "drive_delete", "payload" => %{"path" => path}}} ->
            DriveSync.file_deleted(acc.agent_id, path)
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
    with_sprite_op(state, "sync drive file #{path}", fn ->
      # Step 1: Create marker FIRST to prevent agent-runner from echoing this back
      Sprites.cmd(
        sprite,
        "bash",
        [
          "-c",
          ~S|set -e; mkdir -p "/workspace/.drive-sync/$(dirname "$1")"; touch "/workspace/.drive-sync/$1"; mkdir -p "$(dirname "/workspace/shared/$1")"|,
          "--",
          path
        ],
        timeout: @cmd_timeout
      )

      # Step 2: Write file content via filesystem API
      # (Sprites.cmd doesn't support piping stdin data — it only enables the stdin flag)
      fs = SpriteHelpers.filesystem(sprite)
      Sprites.Filesystem.write(fs, "/workspace/shared/#{path}", content)
    end)
  end

  def handle_cast({:drive_delete, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    with_sprite_op(state, "delete drive file #{path}", fn ->
      Sprites.cmd(
        sprite,
        "bash",
        [
          "-c",
          ~S|set -e; mkdir -p "/workspace/.drive-sync/$(dirname "$1")"; touch "/workspace/.drive-sync/$1"; rm -f "/workspace/shared/$1"|,
          "--",
          path
        ],
        timeout: @cmd_timeout
      )
    end)
  end

  def handle_cast({:drive_create_dir, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    with_sprite_op(state, "create drive dir #{path}", fn ->
      Sprites.cmd(sprite, "mkdir", ["-p", "/workspace/shared/#{path}"], timeout: @cmd_timeout)
    end)
  end

  def handle_cast({:drive_delete_dir, path}, %{sprite: sprite} = state)
      when not is_nil(sprite) do
    with_sprite_op(state, "delete drive dir #{path}", fn ->
      Sprites.cmd(sprite, "rm", ["-rf", "/workspace/shared/#{path}"], timeout: @cmd_timeout)
    end)
  end

  # Catch-all for drive casts when sprite is nil
  def handle_cast({drive_op, _path}, state)
      when drive_op in [:drive_delete, :drive_create_dir, :drive_delete_dir] do
    {:noreply, state}
  end

  def handle_cast({:drive_sync, _path, _content}, state) do
    {:noreply, state}
  end

  # --- Private ---

  defp transition_phase(state, phase) do
    state = %{state | phase: phase}
    Shire.Agent.Coordinator.notify_status(state.agent_id, phase)
    state
  end

  defp with_sprite_op(state, description, fun) do
    try do
      fun.()
    rescue
      e ->
        Logger.warning("Failed to #{description} on #{state.agent_name}: #{inspect(e)}")
    end

    {:noreply, state}
  end

  defp run_bootstrap(agent_id, sprite) do
    wait_for_ready(sprite)
    run_bootstrap_script(sprite)

    agent = Agents.get_agent!(agent_id)
    recipe = Agent.parse_recipe!(agent)
    fs = SpriteHelpers.filesystem(sprite)

    deploy_config(sprite, fs, agent_id, recipe)
    deploy_skills(sprite, fs, recipe, recipe["harness"] || "claude_code")
    deploy_runtime_files(fs)
    run_recipe_scripts(sprite, recipe)
    install_dependencies(sprite)

    DriveSync.ensure_started()
    DriveSync.sync_to_agent(agent_id, sprite)

    :ok
  rescue
    e -> {:error, e}
  end

  defp run_bootstrap_script(sprite) do
    bootstrap_script =
      File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script], timeout: 120_000)
  end

  defp deploy_config(_sprite, fs, agent_id, recipe) do
    harness = recipe["harness"] || "claude_code"
    secrets = Agents.effective_secrets(agent_id)

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

    :ok = Sprites.Filesystem.write(fs, "/workspace/agent-config.json", config)
    :ok = Sprites.Filesystem.write(fs, "/workspace/peers.json", "[]")
    :ok = Sprites.Filesystem.write(fs, "/workspace/recipe.json", Jason.encode!(recipe))

    env_content = Enum.map_join(secrets, "\n", fn s -> "#{s.key}=#{s.value}" end)
    :ok = Sprites.Filesystem.write(fs, "/workspace/.env", env_content)
  end

  defp deploy_runtime_files(fs) do
    runtime_files = [
      "agent-runner.ts",
      "recipe-runner.ts",
      "package.json",
      "harness/types.ts",
      "harness/pi-harness.ts",
      "harness/claude-code-harness.ts",
      "harness/index.ts"
    ]

    for file <- runtime_files do
      source = File.read!(Application.app_dir(:shire, "priv/sprite/#{file}"))
      :ok = Sprites.Filesystem.write(fs, "/workspace/#{file}", source)
    end
  end

  defp run_recipe_scripts(sprite, recipe) do
    if recipe["scripts"] && recipe["scripts"] != [] do
      Sprites.cmd(sprite, "bun", ["run", "/workspace/recipe-runner.ts"], timeout: 300_000)
    end
  end

  defp install_dependencies(sprite) do
    {_, 0} =
      Sprites.cmd(sprite, "bash", ["-c", "cd /workspace && bun install"], timeout: 60_000)
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
        # No matching tool_use found — create a new one
        state = flush_and_broadcast_streaming(state)
        tool = Map.get(payload, "tool", "unknown")

        case Agents.create_message(%{
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
    state
  end

  defp persist_and_broadcast(state, %{"type" => "text", "payload" => %{"text" => text}} = event) do
    state = flush_and_broadcast_streaming(state)

    case Agents.create_message(%{
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
