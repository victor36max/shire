defmodule Shire.Agent.Coordinator do
  @moduledoc """
  Manages the single shared Sprite VM and agent lifecycle.
  Starts/stops AgentManagers via DynamicSupervisor.
  """
  use GenServer
  require Logger

  alias Shire.Agent.AgentManager

  @vm_name Application.compile_env(:shire, :sprite_vm_name, "shire-vm")
  @cmd_timeout 30_000
  @ready_retries 6
  @ready_backoff 5_000

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  @doc "Start an agent by name. Creates workspace dir and spawns runner."
  def start_agent(agent_name, opts \\ []) do
    GenServer.call(__MODULE__, {:start_agent, agent_name, opts}, 60_000)
  end

  @doc "Returns the current status for an agent (defaults to :created if not tracked)."
  def agent_status(agent_name) do
    GenServer.call(__MODULE__, {:agent_status, agent_name})
  end

  @doc "Returns a map of `%{agent_name => status}` for the given agent names."
  def agent_statuses(agent_names) do
    GenServer.call(__MODULE__, {:agent_statuses, agent_names})
  end

  @doc "Called by AgentManager to notify status changes."
  def notify_status(agent_name, status) do
    GenServer.cast(__MODULE__, {:agent_status_changed, agent_name, status})
  end

  def kill_agent(agent_name) do
    GenServer.call(__MODULE__, {:kill_agent, agent_name})
  end

  def restart_agent(agent_name) do
    GenServer.call(__MODULE__, {:restart_agent, agent_name}, 60_000)
  end

  def send_message(agent_name, text) do
    AgentManager.send_message(agent_name, text, :user)
  end

  @doc "Returns the shared Sprite VM reference."
  def get_sprite do
    GenServer.call(__MODULE__, :get_sprite)
  end

  @doc "Returns a Sprites.Filesystem handle for the shared VM."
  def get_filesystem do
    GenServer.call(__MODULE__, :get_filesystem)
  end

  @doc "Look up a running agent's pid by name."
  def lookup(agent_name) do
    case Registry.lookup(Shire.AgentRegistry, agent_name) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @doc "Returns all running agent names."
  def list_running do
    Registry.select(Shire.AgentRegistry, [
      {{:"$1", :"$2", :_}, [{:is_binary, :"$1"}], [:"$1"]}
    ])
  end

  @doc """
  Lists agents by scanning `/workspace/agents/` on the VM.
  Returns `[%{name: name, ...}]` for each agent directory with a recipe.yaml.
  """
  def list_agents do
    GenServer.call(__MODULE__, :list_agents, 30_000)
  end

  @doc "Reads an agent's recipe.yaml from the VM."
  def get_agent(agent_name) do
    GenServer.call(__MODULE__, {:get_agent, agent_name}, 15_000)
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    state = %{
      sprite: nil,
      fs: nil,
      monitors: %{},
      statuses: %{}
    }

    {:ok, state, {:continue, :init_vm}}
  end

  @impl true
  def handle_continue(:init_vm, state) do
    token = Application.get_env(:shire, :sprites_token)

    if token do
      case init_shared_vm(token) do
        {:ok, sprite, fs} ->
          Logger.info("Shared VM #{@vm_name} ready")
          state = %{state | sprite: sprite, fs: fs}
          {:noreply, state, {:continue, :scan_agents}}

        {:error, reason} ->
          Logger.error("Failed to initialize shared VM: #{inspect(reason)}")
          {:noreply, state}
      end
    else
      Logger.warning("No SPRITES_TOKEN configured — VM features disabled")
      {:noreply, state}
    end
  end

  @impl true
  def handle_continue(:scan_agents, %{sprite: nil} = state), do: {:noreply, state}

  def handle_continue(:scan_agents, state) do
    {:ok, agent_names} = scan_agent_dirs(state.sprite)

    monitors =
      Enum.reduce(agent_names, state.monitors, fn name, acc ->
        case start_agent_manager(name, %{state | monitors: acc}) do
          {:ok, _pid, updated_monitors} -> updated_monitors
          {:error, _} -> acc
        end
      end)

    Logger.info("Scanned and started #{length(agent_names)} agents")
    {:noreply, %{state | monitors: monitors}}
  end

  @impl true
  def handle_call({:start_agent, agent_name, _opts}, _from, state) do
    case lookup(agent_name) do
      {:ok, _pid} ->
        # Agent process exists — restart if failed, reject if active
        case Map.get(state.statuses, agent_name) do
          :failed ->
            case AgentManager.restart(agent_name) do
              :ok ->
                Logger.info("Restarting failed agent #{agent_name}")
                {:reply, {:ok, :restarted}, state}

              {:error, reason} ->
                {:reply, {:error, reason}, state}
            end

          _ ->
            {:reply, {:error, :already_running}, state}
        end

      {:error, :not_found} ->
        # New agent — requires VM
        if state.sprite do
          case start_agent_manager(agent_name, state) do
            {:ok, pid, monitors} ->
              {:reply, {:ok, pid}, %{state | monitors: monitors}}

            {:error, reason} ->
              {:reply, {:error, reason}, state}
          end
        else
          {:reply, {:error, :no_vm}, state}
        end
    end
  end

  @impl true
  def handle_call({:kill_agent, agent_name}, _from, state) do
    case lookup(agent_name) do
      {:ok, pid} ->
        DynamicSupervisor.terminate_child(Shire.AgentSupervisor, pid)

        # Clean up monitor for this agent
        {ref, monitors} =
          Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, name} ->
            if name == agent_name, do: {ref, Map.delete(state.monitors, ref)}
          end)

        if ref, do: Process.demonitor(ref, [:flush])

        statuses = Map.delete(state.statuses, agent_name)
        Logger.info("Killed agent #{agent_name}")
        {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_call({:restart_agent, agent_name}, _from, state) do
    case lookup(agent_name) do
      {:ok, _pid} ->
        case AgentManager.restart(agent_name) do
          :ok ->
            Logger.info("Restarting agent #{agent_name}")
            {:reply, :ok, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_call({:agent_status, agent_name}, _from, state) do
    {:reply, Map.get(state.statuses, agent_name, :created), state}
  end

  @impl true
  def handle_call({:agent_statuses, agent_names}, _from, state) do
    result = Map.new(agent_names, fn name -> {name, Map.get(state.statuses, name, :created)} end)
    {:reply, result, state}
  end

  @impl true
  def handle_call(:get_sprite, _from, state) do
    {:reply, state.sprite, state}
  end

  @impl true
  def handle_call(:get_filesystem, _from, state) do
    {:reply, state.fs, state}
  end

  @impl true
  def handle_call(:list_agents, _from, %{sprite: nil} = state) do
    {:reply, [], state}
  end

  def handle_call(:list_agents, _from, state) do
    {:ok, names} = scan_agent_dirs(state.sprite)

    agents =
      Enum.map(names, fn name ->
        status = Map.get(state.statuses, name, :created)
        %{name: name, status: status}
      end)

    {:reply, agents, state}
  end

  @impl true
  def handle_call({:get_agent, _agent_name}, _from, %{sprite: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:get_agent, agent_name}, _from, state) do
    case read_agent_recipe(state.sprite, agent_name) do
      {:ok, recipe} ->
        status = Map.get(state.statuses, agent_name, :created)
        {:reply, {:ok, Map.put(recipe, :status, status)}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    {agent_name, monitors} = Map.pop(state.monitors, ref)

    if agent_name do
      Logger.warning("Agent #{agent_name} process died: #{inspect(reason)}")

      statuses = Map.put(state.statuses, agent_name, :crashed)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:#{agent_name}",
        {:status, :crashed}
      )

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, agent_name, :crashed}
      )

      {:noreply, %{state | monitors: monitors, statuses: statuses}}
    else
      {:noreply, %{state | monitors: monitors}}
    end
  end

  def handle_info(msg, state) do
    Logger.debug("Coordinator unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def handle_cast({:agent_status_changed, agent_name, status}, state) do
    statuses = Map.put(state.statuses, agent_name, status)

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agent:#{agent_name}",
      {:status, status}
    )

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agents:lobby",
      {:agent_status, agent_name, status}
    )

    {:noreply, %{state | statuses: statuses}}
  end

  # --- Private ---

  defp init_shared_vm(token) do
    client = Sprites.new(token)

    sprite =
      case Sprites.get_sprite(client, @vm_name) do
        {:ok, _info} -> Sprites.sprite(client, @vm_name)
        {:error, {:not_found, _}} -> elem(Sprites.create(client, @vm_name), 1)
      end

    wait_for_ready(sprite)
    run_bootstrap(sprite)
    deploy_runner(sprite)

    fs = Sprites.Filesystem.new(sprite)
    {:ok, sprite, fs}
  rescue
    e -> {:error, e}
  end

  defp wait_for_ready(sprite, attempt \\ 1) do
    Sprites.cmd(sprite, "echo", ["ready"], timeout: 10_000)
    :ok
  rescue
    e ->
      if attempt < @ready_retries do
        Logger.info(
          "VM not ready (attempt #{attempt}/#{@ready_retries}), retrying in #{@ready_backoff}ms..."
        )

        Process.sleep(@ready_backoff)
        wait_for_ready(sprite, attempt + 1)
      else
        raise e
      end
  end

  defp run_bootstrap(sprite) do
    bootstrap_script =
      File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    {_, 0} = Sprites.cmd(sprite, "bash", ["-c", bootstrap_script], timeout: 120_000)
  end

  defp deploy_runner(sprite) do
    fs = Sprites.Filesystem.new(sprite)
    runner_dir = Application.app_dir(:shire, "priv/sprite")

    # Deploy agent-runner.ts and harness files
    for file <- ["agent-runner.ts"] do
      content = File.read!(Path.join(runner_dir, file))
      Sprites.Filesystem.write!(fs, "/workspace/.runner/#{file}", content)
    end

    # Deploy harness directory
    harness_dir = Path.join(runner_dir, "harness")

    if File.dir?(harness_dir) do
      Sprites.cmd(sprite, "mkdir", ["-p", "/workspace/.runner/harness"], timeout: @cmd_timeout)

      for file <- File.ls!(harness_dir) do
        content = File.read!(Path.join(harness_dir, file))
        Sprites.Filesystem.write!(fs, "/workspace/.runner/harness/#{file}", content)
      end
    end

    # Install runner dependencies
    Sprites.cmd(sprite, "bash", ["-c", "cd /workspace/.runner && bun install"], timeout: 120_000)
  end

  defp scan_agent_dirs(sprite) do
    case Sprites.cmd(sprite, "ls", ["/workspace/agents"], timeout: @cmd_timeout) do
      {output, 0} ->
        names =
          output
          |> String.split("\n", trim: true)
          |> Enum.filter(fn name ->
            # Only include dirs that have a recipe.yaml
            case Sprites.cmd(sprite, "test", ["-f", "/workspace/agents/#{name}/recipe.yaml"],
                   timeout: @cmd_timeout
                 ) do
              {_, 0} -> true
              _ -> false
            end
          end)

        {:ok, names}

      {_, _} ->
        {:ok, []}
    end
  rescue
    _ -> {:ok, []}
  end

  defp read_agent_recipe(sprite, agent_name) do
    path = "/workspace/agents/#{agent_name}/recipe.yaml"

    case Sprites.cmd(sprite, "cat", [path], timeout: @cmd_timeout) do
      {content, 0} ->
        case YamlElixir.read_from_string(content) do
          {:ok, recipe} -> {:ok, recipe}
          {:error, reason} -> {:error, reason}
        end

      {_, _} ->
        {:error, :not_found}
    end
  end

  defp start_agent_manager(agent_name, state) do
    opts = [
      agent_name: agent_name,
      sprite: state.sprite,
      fs: state.fs
    ]

    case DynamicSupervisor.start_child(
           Shire.AgentSupervisor,
           {AgentManager, opts}
         ) do
      {:ok, pid} ->
        ref = Process.monitor(pid)
        monitors = Map.put(state.monitors, ref, agent_name)
        Logger.info("Started agent #{agent_name}")
        {:ok, pid, monitors}

      {:error, reason} ->
        Logger.error("Failed to start agent #{agent_name}: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
