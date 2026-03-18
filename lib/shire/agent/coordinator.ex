defmodule Shire.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle on the shared Sprite VM.
  Starts/stops AgentManagers via DynamicSupervisor.
  VM initialization is handled by Shire.VirtualMachine.
  """
  use GenServer
  require Logger

  alias Shire.Agent.AgentManager

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  @doc "Returns the current status for an agent (defaults to :created if not tracked)."
  def agent_status(agent_name) do
    GenServer.call(__MODULE__, {:agent_status, agent_name})
  end

  @doc "Returns a map of `%{agent_name => status}` for the given agent names."
  def agent_statuses(agent_names) do
    GenServer.call(__MODULE__, {:agent_statuses, agent_names})
  end

  @doc "Creates a new agent: writes recipe.yaml on VM and starts runner."
  def create_agent(attrs) do
    GenServer.call(__MODULE__, {:create_agent, attrs}, 60_000)
  end

  @doc "Updates an agent's recipe.yaml on the VM."
  def update_agent(agent_name, attrs) do
    GenServer.call(__MODULE__, {:update_agent, agent_name, attrs}, 30_000)
  end

  def delete_agent(agent_name) do
    GenServer.call(__MODULE__, {:delete_agent, agent_name}, 30_000)
  end

  def restart_agent(agent_name) do
    GenServer.call(__MODULE__, {:restart_agent, agent_name}, 60_000)
  end

  def send_message(agent_name, text) do
    AgentManager.send_message(agent_name, text, :user)
  end

  @doc "Reads `/workspace/.env` from the VM and returns it as a string."
  def read_env do
    GenServer.call(__MODULE__, :read_env, 15_000)
  end

  @doc "Writes the given string to `/workspace/.env` on the VM."
  def write_env(content) do
    GenServer.call(__MODULE__, {:write_env, content}, 15_000)
  end

  @doc "Lists script filenames in `/workspace/.scripts/`."
  def list_scripts do
    GenServer.call(__MODULE__, :list_scripts, 15_000)
  end

  @doc "Reads a script file from `/workspace/.scripts/{name}`."
  def read_script(name) do
    GenServer.call(__MODULE__, {:read_script, name}, 15_000)
  end

  @doc "Writes a script file to `/workspace/.scripts/{name}`."
  def write_script(name, content) do
    GenServer.call(__MODULE__, {:write_script, name, content}, 15_000)
  end

  @doc "Deletes a script file from `/workspace/.scripts/{name}`."
  def delete_script(name) do
    GenServer.call(__MODULE__, {:delete_script, name}, 15_000)
  end

  @doc "Runs a script from `/workspace/.scripts/{name}` and returns output."
  def run_script(name) do
    GenServer.call(__MODULE__, {:run_script, name}, 120_000)
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
    Phoenix.PubSub.subscribe(Shire.PubSub, "agents:lobby")

    state = %{
      monitors: %{},
      statuses: %{}
    }

    {:ok, state, {:continue, :deploy_and_scan}}
  end

  @impl true
  def handle_continue(:deploy_and_scan, state) do
    case run_bootstrap() do
      :ok -> :ok
      {:error, reason} -> Logger.error("Bootstrap failed: #{inspect(reason)}")
    end

    case deploy_runner() do
      :ok -> :ok
      {:error, reason} -> Logger.error("Runner deployment failed: #{inspect(reason)}")
    end

    {:ok, agent_names} = scan_agent_dirs()

    monitors =
      Enum.reduce(agent_names, state.monitors, fn name, acc ->
        case start_agent_manager(name, acc) do
          {:ok, _pid, updated_monitors} -> updated_monitors
          {:error, _} -> acc
        end
      end)

    Logger.info("Scanned and started #{length(agent_names)} agents")
    {:noreply, %{state | monitors: monitors}}
  end

  @impl true
  def handle_call({:create_agent, %{"name" => name, "recipe_yaml" => recipe_yaml}}, _from, state) do
    agent_dir = "/workspace/agents/#{name}"

    # Check if agent already exists (exit codes unreliable via Sprites, use echo)
    case @vm.cmd("bash", ["-c", "test -d #{agent_dir} && echo exists || echo missing"], []) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      {:ok, output} ->
        if String.trim(output) == "exists" do
          {:reply, {:error, :already_exists}, state}
        else
          create_agent_on_vm(name, agent_dir, recipe_yaml, state)
        end
    end
  end

  @impl true
  def handle_call({:create_agent, _attrs}, _from, state) do
    {:reply, {:error, :missing_name_or_recipe}, state}
  end

  @impl true
  def handle_call({:update_agent, name, %{"recipe_yaml" => recipe_yaml}}, _from, state) do
    agent_dir = "/workspace/agents/#{name}"

    case @vm.write("#{agent_dir}/recipe.yaml", recipe_yaml) do
      :ok ->
        case lookup(name) do
          {:ok, _pid} -> AgentManager.restart(name)
          {:error, :not_found} -> :ok
        end

        Phoenix.PubSub.broadcast(Shire.PubSub, "agents:lobby", {:agent_updated, name})
        {:reply, :ok, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:update_agent, _name, _attrs}, _from, state) do
    {:reply, {:error, :missing_recipe_yaml}, state}
  end

  @impl true
  def handle_call({:delete_agent, agent_name}, _from, state) do
    # Stop the process if running
    case lookup(agent_name) do
      {:ok, pid} ->
        DynamicSupervisor.terminate_child(Shire.AgentSupervisor, pid)

      {:error, :not_found} ->
        :ok
    end

    # Clean up monitor
    {ref, monitors} =
      Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, name} ->
        if name == agent_name, do: {ref, Map.delete(state.monitors, ref)}
      end)

    if ref, do: Process.demonitor(ref, [:flush])

    # Remove agent directory from VM
    case @vm.cmd("rm", ["-rf", "/workspace/agents/#{agent_name}"], []) do
      {:ok, _} ->
        :ok

      {:error, reason} ->
        Logger.warning("Failed to remove agent dir for #{agent_name}: #{inspect(reason)}")
    end

    statuses = Map.delete(state.statuses, agent_name)
    Logger.info("Deleted agent #{agent_name}")
    Phoenix.PubSub.broadcast(Shire.PubSub, "agents:lobby", {:agent_deleted, agent_name})
    {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}
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
        # No process exists — spawn a fresh AgentManager
        case start_agent_manager(agent_name, state.monitors) do
          {:ok, _pid, monitors} ->
            Logger.info("Started agent #{agent_name} (was not running)")
            {:reply, :ok, %{state | monitors: monitors}}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
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

  # --- Env / Scripts ---

  @impl true
  def handle_call(:read_env, _from, state) do
    # Use bash -c to handle missing file (exit codes unreliable via Sprites)
    case @vm.cmd("bash", ["-c", "test -f /workspace/.env && cat /workspace/.env || echo ''"], []) do
      {:ok, output} -> {:reply, {:ok, output}, state}
      {:error, _} -> {:reply, {:ok, ""}, state}
    end
  end

  @impl true
  def handle_call({:write_env, content}, _from, state) do
    case @vm.write("/workspace/.env", content) do
      :ok -> {:reply, :ok, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call(:list_scripts, _from, state) do
    # Use bash -c to handle missing dir (exit codes unreliable via Sprites)
    case @vm.cmd(
           "bash",
           ["-c", "test -d /workspace/.scripts && ls /workspace/.scripts || echo ''"],
           []
         ) do
      {:ok, output} ->
        names =
          output
          |> String.split("\n", trim: true)
          |> Enum.filter(&String.ends_with?(&1, ".sh"))

        {:reply, {:ok, names}, state}

      {:error, _} ->
        {:reply, {:ok, []}, state}
    end
  end

  @impl true
  def handle_call({:read_script, name}, _from, state) do
    path = "/workspace/.scripts/#{name}"

    case @vm.cmd("bash", ["-c", "test -f #{path} && cat #{path} || echo '__NOT_FOUND__'"], []) do
      {:ok, output} ->
        result =
          if String.trim(output) == "__NOT_FOUND__" do
            {:error, :not_found}
          else
            {:ok, output}
          end

        {:reply, result, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:write_script, name, content}, _from, state) do
    path = "/workspace/.scripts/#{name}"

    with :ok <- @vm.write(path, content),
         {:ok, _} <- @vm.cmd("chmod", ["+x", path], []) do
      {:reply, :ok, state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:delete_script, name}, _from, state) do
    path = "/workspace/.scripts/#{name}"
    @vm.cmd("rm", ["-f", path], [])
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:run_script, name}, _from, state) do
    path = "/workspace/.scripts/#{name}"
    # Source .env before running the script so env vars are available
    script_cmd = "[ -f /workspace/.env ] && set -a && . /workspace/.env && set +a; bash #{path}"

    case @vm.cmd("bash", ["-c", script_cmd], timeout: 120_000) do
      {:ok, output} -> {:reply, {:ok, output}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call(:list_agents, _from, state) do
    {:ok, names} = scan_agent_dirs()

    agents =
      Enum.map(names, fn name ->
        status = Map.get(state.statuses, name, :created)
        %{name: name, status: status}
      end)

    {:reply, agents, state}
  end

  @impl true
  def handle_call({:get_agent, agent_name}, _from, state) do
    case read_agent_recipe(agent_name) do
      {:ok, recipe} ->
        status = Map.get(state.statuses, agent_name, :created)

        agent = %{
          name: recipe["name"] || agent_name,
          description: recipe["description"],
          harness: recipe["harness"] || "claude_code",
          model: recipe["model"],
          system_prompt: recipe["system_prompt"],
          skills: recipe["skills"] || [],
          status: status
        }

        {:reply, {:ok, agent}, state}

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

  @impl true
  def handle_info({:agent_status, agent_name, status}, state) do
    statuses = Map.put(state.statuses, agent_name, status)
    {:noreply, %{state | statuses: statuses}}
  end

  @impl true
  def handle_info({:agent_busy, _agent_name, _active}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:agent_created, _name}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("Coordinator unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # --- Private ---

  defp run_bootstrap do
    script = File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    case @vm.cmd("bash", ["-c", script], timeout: 120_000) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp deploy_runner do
    runner_dir = Application.app_dir(:shire, "priv/sprite")

    # Deploy agent-runner.ts
    content = File.read!(Path.join(runner_dir, "agent-runner.ts"))

    with :ok <- @vm.write("/workspace/.runner/agent-runner.ts", content),
         :ok <- deploy_harness(runner_dir),
         {:ok, _} <-
           @vm.cmd("bash", ["-c", "cd /workspace/.runner && bun install"], timeout: 120_000) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp deploy_harness(runner_dir) do
    harness_dir = Path.join(runner_dir, "harness")

    if File.dir?(harness_dir) do
      with {:ok, _} <- @vm.cmd("mkdir", ["-p", "/workspace/.runner/harness"], []) do
        Enum.reduce_while(File.ls!(harness_dir), :ok, fn file, :ok ->
          content = File.read!(Path.join(harness_dir, file))

          case @vm.write("/workspace/.runner/harness/#{file}", content) do
            :ok -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)
      end
    else
      :ok
    end
  end

  defp scan_agent_dirs do
    cmd = ~s(for d in /workspace/agents/*/; do test -f "$d/recipe.yaml" && basename "$d"; done)

    case @vm.cmd("bash", ["-c", cmd], []) do
      {:ok, output} ->
        names = String.split(output, "\n", trim: true)
        {:ok, names}

      {:error, _} ->
        {:ok, []}
    end
  rescue
    e ->
      Logger.error("scan_agent_dirs crashed: #{inspect(e)}")
      {:ok, []}
  end

  defp read_agent_recipe(agent_name) do
    path = "/workspace/agents/#{agent_name}/recipe.yaml"

    case @vm.cmd("bash", ["-c", "test -f #{path} && cat #{path} || echo '__NOT_FOUND__'"], []) do
      {:error, reason} ->
        {:error, reason}

      {:ok, output} ->
        if String.trim(output) == "__NOT_FOUND__" do
          {:error, :not_found}
        else
          case YamlElixir.read_from_string(output) do
            {:ok, recipe} -> {:ok, recipe}
            {:error, reason} -> {:error, reason}
          end
        end
    end
  end

  defp create_agent_on_vm(name, agent_dir, recipe_yaml, state) do
    # Create directory structure
    mkdir_results =
      Enum.map(["inbox", "outbox", "scripts", "documents"], fn subdir ->
        @vm.cmd("mkdir", ["-p", "#{agent_dir}/#{subdir}"], [])
      end)

    case Enum.find(mkdir_results, &match?({:error, _}, &1)) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      nil ->
        case @vm.write("#{agent_dir}/recipe.yaml", recipe_yaml) do
          :ok ->
            case start_agent_manager(name, state.monitors) do
              {:ok, pid, monitors} ->
                Phoenix.PubSub.broadcast(Shire.PubSub, "agents:lobby", {:agent_created, name})
                {:reply, {:ok, pid}, %{state | monitors: monitors}}

              {:error, reason} ->
                {:reply, {:error, reason}, state}
            end

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
    end
  end

  defp start_agent_manager(agent_name, monitors) do
    opts = [agent_name: agent_name]

    case DynamicSupervisor.start_child(
           Shire.AgentSupervisor,
           {AgentManager, opts}
         ) do
      {:ok, pid} ->
        ref = Process.monitor(pid)
        monitors = Map.put(monitors, ref, agent_name)
        Logger.info("Started agent #{agent_name}")
        {:ok, pid, monitors}

      {:error, reason} ->
        Logger.error("Failed to start agent #{agent_name}: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
