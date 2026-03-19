defmodule Shire.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle on a project's Sprite VM.
  Each project gets its own Coordinator, registered via ProjectRegistry.
  Starts/stops AgentManagers via the project-scoped DynamicSupervisor.
  """
  use GenServer
  require Logger

  alias Shire.Agent.AgentManager

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  def start_link(opts) do
    project_name = Keyword.fetch!(opts, :project_name)
    GenServer.start_link(__MODULE__, opts, name: via(project_name))
  end

  defp via(project_name) do
    {:via, Registry, {Shire.ProjectRegistry, {:coordinator, project_name}}}
  end

  # --- Public API ---

  @doc "Returns the current status for an agent (defaults to :created if not tracked)."
  def agent_status(project_name, agent_name) do
    GenServer.call(via(project_name), {:agent_status, agent_name})
  end

  @doc "Returns a map of `%{agent_name => status}` for the given agent names."
  def agent_statuses(project_name, agent_names) do
    GenServer.call(via(project_name), {:agent_statuses, agent_names})
  end

  @doc "Creates a new agent: writes recipe.yaml on VM and starts runner."
  def create_agent(project_name, attrs) do
    GenServer.call(via(project_name), {:create_agent, attrs}, 60_000)
  end

  @doc "Updates an agent's recipe.yaml on the VM."
  def update_agent(project_name, agent_name, attrs) do
    GenServer.call(via(project_name), {:update_agent, agent_name, attrs}, 30_000)
  end

  def delete_agent(project_name, agent_name) do
    GenServer.call(via(project_name), {:delete_agent, agent_name}, 30_000)
  end

  def restart_agent(project_name, agent_name) do
    GenServer.call(via(project_name), {:restart_agent, agent_name}, 60_000)
  end

  def send_message(project_name, agent_name, text) do
    AgentManager.send_message(project_name, agent_name, text, :user)
  end

  @doc "Look up a running agent's pid by name within a project."
  def lookup(project_name, agent_name) do
    case Registry.lookup(Shire.AgentRegistry, {project_name, agent_name}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @doc "Returns all running agent names for a project."
  def list_running(project_name) do
    Registry.select(Shire.AgentRegistry, [
      {{{project_name, :"$1"}, :"$2", :_}, [], [:"$1"]}
    ])
  end

  @doc """
  Lists agents by scanning `/workspace/agents/` on the VM.
  Returns `[%{name: name, ...}]` for each agent directory with a recipe.yaml.
  """
  def list_agents(project_name) do
    GenServer.call(via(project_name), :list_agents, 30_000)
  end

  @doc "Reads an agent's recipe.yaml from the VM."
  def get_agent(project_name, agent_name) do
    GenServer.call(via(project_name), {:get_agent, agent_name}, 15_000)
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    project_name = Keyword.fetch!(opts, :project_name)

    Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_name}:agents:lobby")

    state = %{
      project_name: project_name,
      monitors: %{},
      statuses: %{}
    }

    {:ok, state, {:continue, :deploy_and_scan}}
  end

  @impl true
  def handle_continue(:deploy_and_scan, state) do
    case Shire.WorkspaceSettings.bootstrap_workspace(state.project_name) do
      :ok -> :ok
      {:error, reason} -> Logger.error("Bootstrap failed: #{inspect(reason)}")
    end

    case deploy_runner(state.project_name) do
      :ok -> :ok
      {:error, reason} -> Logger.error("Runner deployment failed: #{inspect(reason)}")
    end

    {:ok, agent_names} = scan_agent_dirs(state.project_name)

    monitors =
      Enum.reduce(agent_names, state.monitors, fn name, acc ->
        case start_agent_manager(state.project_name, name, acc) do
          {:ok, _pid, updated_monitors} -> updated_monitors
          {:error, _} -> acc
        end
      end)

    Logger.info(
      "Project #{state.project_name}: scanned and started #{length(agent_names)} agents"
    )

    {:noreply, %{state | monitors: monitors}}
  end

  @impl true
  def handle_call({:create_agent, %{"name" => name, "recipe_yaml" => recipe_yaml}}, _from, state) do
    agent_dir = "/workspace/agents/#{name}"

    case @vm.cmd(
           state.project_name,
           "bash",
           ["-c", "test -d #{agent_dir} && echo exists || echo missing"],
           []
         ) do
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
    new_name = extract_name_from_yaml(recipe_yaml)

    if new_name && new_name != name do
      rename_agent(name, new_name, recipe_yaml, state)
    else
      agent_dir = "/workspace/agents/#{name}"

      case @vm.write(state.project_name, "#{agent_dir}/recipe.yaml", recipe_yaml) do
        :ok ->
          case lookup(state.project_name, name) do
            {:ok, _pid} -> AgentManager.restart(state.project_name, name)
            {:error, :not_found} -> :ok
          end

          Phoenix.PubSub.broadcast(
            Shire.PubSub,
            "project:#{state.project_name}:agents:lobby",
            {:agent_updated, name}
          )

          {:reply, :ok, state}

        {:error, reason} ->
          {:reply, {:error, reason}, state}
      end
    end
  end

  @impl true
  def handle_call({:update_agent, _name, _attrs}, _from, state) do
    {:reply, {:error, :missing_recipe_yaml}, state}
  end

  @impl true
  def handle_call({:delete_agent, agent_name}, _from, state) do
    # Stop the process if running
    case lookup(state.project_name, agent_name) do
      {:ok, pid} ->
        agent_sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, state.project_name}}}
        DynamicSupervisor.terminate_child(agent_sup, pid)

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
    case @vm.cmd(state.project_name, "rm", ["-rf", "/workspace/agents/#{agent_name}"], []) do
      {:ok, _} ->
        :ok

      {:error, reason} ->
        Logger.warning("Failed to remove agent dir for #{agent_name}: #{inspect(reason)}")
    end

    statuses = Map.delete(state.statuses, agent_name)
    Logger.info("Deleted agent #{agent_name}")

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{state.project_name}:agents:lobby",
      {:agent_deleted, agent_name}
    )

    {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}
  end

  @impl true
  def handle_call({:restart_agent, agent_name}, _from, state) do
    case lookup(state.project_name, agent_name) do
      {:ok, _pid} ->
        case AgentManager.restart(state.project_name, agent_name) do
          :ok ->
            Logger.info("Restarting agent #{agent_name}")
            {:reply, :ok, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      {:error, :not_found} ->
        case start_agent_manager(state.project_name, agent_name, state.monitors) do
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

  @impl true
  def handle_call(:list_agents, _from, state) do
    {:ok, names} = scan_agent_dirs(state.project_name)

    agents =
      Enum.map(names, fn name ->
        status = Map.get(state.statuses, name, :created)
        %{name: name, status: status}
      end)

    {:reply, agents, state}
  end

  @impl true
  def handle_call({:get_agent, agent_name}, _from, state) do
    case read_agent_recipe(state.project_name, agent_name) do
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
        "project:#{state.project_name}:agent:#{agent_name}",
        {:status, :crashed}
      )

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_name}:agents:lobby",
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

  defp deploy_runner(project_name) do
    runner_dir = Application.app_dir(:shire, "priv/sprite")

    content = File.read!(Path.join(runner_dir, "agent-runner.ts"))

    with :ok <- @vm.write(project_name, "/workspace/.runner/agent-runner.ts", content),
         :ok <- deploy_harness(project_name, runner_dir),
         {:ok, _} <-
           @vm.cmd(project_name, "bash", ["-c", "cd /workspace/.runner && bun install"],
             timeout: 120_000
           ) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp deploy_harness(project_name, runner_dir) do
    harness_dir = Path.join(runner_dir, "harness")

    if File.dir?(harness_dir) do
      with {:ok, _} <- @vm.cmd(project_name, "mkdir", ["-p", "/workspace/.runner/harness"], []) do
        Enum.reduce_while(File.ls!(harness_dir), :ok, fn file, :ok ->
          content = File.read!(Path.join(harness_dir, file))

          case @vm.write(project_name, "/workspace/.runner/harness/#{file}", content) do
            :ok -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)
      end
    else
      :ok
    end
  end

  defp scan_agent_dirs(project_name) do
    cmd = ~s(for d in /workspace/agents/*/; do test -f "$d/recipe.yaml" && basename "$d"; done)

    case @vm.cmd(project_name, "bash", ["-c", cmd], []) do
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

  defp read_agent_recipe(project_name, agent_name) do
    path = "/workspace/agents/#{agent_name}/recipe.yaml"

    case @vm.cmd(
           project_name,
           "bash",
           ["-c", "test -f #{path} && cat #{path} || echo '__NOT_FOUND__'"],
           []
         ) do
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
    mkdir_results =
      Enum.map(["inbox", "outbox", "scripts", "documents"], fn subdir ->
        @vm.cmd(state.project_name, "mkdir", ["-p", "#{agent_dir}/#{subdir}"], [])
      end)

    case Enum.find(mkdir_results, &match?({:error, _}, &1)) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      nil ->
        case @vm.write(state.project_name, "#{agent_dir}/recipe.yaml", recipe_yaml) do
          :ok ->
            case start_agent_manager(state.project_name, name, state.monitors) do
              {:ok, pid, monitors} ->
                Phoenix.PubSub.broadcast(
                  Shire.PubSub,
                  "project:#{state.project_name}:agents:lobby",
                  {:agent_created, name}
                )

                {:reply, {:ok, pid}, %{state | monitors: monitors}}

              {:error, reason} ->
                {:reply, {:error, reason}, state}
            end

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
    end
  end

  defp extract_name_from_yaml(recipe_yaml) do
    case YamlElixir.read_from_string(recipe_yaml) do
      {:ok, %{"name" => name}} when is_binary(name) -> name
      _ -> nil
    end
  end

  defp rename_agent(old_name, new_name, recipe_yaml, state) do
    new_dir = "/workspace/agents/#{new_name}"

    case @vm.cmd(
           state.project_name,
           "bash",
           ["-c", "test -d #{new_dir} && echo exists || echo missing"],
           []
         ) do
      {:ok, output} ->
        if String.trim(output) == "exists" do
          {:reply, {:error, :already_exists}, state}
        else
          do_rename_agent(old_name, new_name, recipe_yaml, state)
        end

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp do_rename_agent(old_name, new_name, recipe_yaml, state) do
    old_dir = "/workspace/agents/#{old_name}"
    new_dir = "/workspace/agents/#{new_name}"

    # Stop old AgentManager if running
    case lookup(state.project_name, old_name) do
      {:ok, pid} ->
        agent_sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, state.project_name}}}
        DynamicSupervisor.terminate_child(agent_sup, pid)

      {:error, :not_found} ->
        :ok
    end

    # Clean up old monitor
    {ref, monitors} =
      Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, name} ->
        if name == old_name, do: {ref, Map.delete(state.monitors, ref)}
      end)

    if ref, do: Process.demonitor(ref, [:flush])

    # Rename directory on VM
    case @vm.cmd(state.project_name, "mv", [old_dir, new_dir], []) do
      {:ok, _} ->
        @vm.write(state.project_name, "#{new_dir}/recipe.yaml", recipe_yaml)

        Shire.Agents.rename_agent_messages(state.project_name, old_name, new_name)

        statuses = state.statuses |> Map.delete(old_name)

        case start_agent_manager(state.project_name, new_name, monitors) do
          {:ok, _pid, monitors} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{state.project_name}:agents:lobby",
              {:agent_renamed, old_name, new_name}
            )

            {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}

          {:error, reason} ->
            Logger.warning(
              "Renamed #{old_name} -> #{new_name} but failed to start: #{inspect(reason)}"
            )

            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{state.project_name}:agents:lobby",
              {:agent_renamed, old_name, new_name}
            )

            {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}
        end

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp start_agent_manager(project_name, agent_name, monitors) do
    opts = [project_name: project_name, agent_name: agent_name]
    agent_sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_name}}}

    case DynamicSupervisor.start_child(agent_sup, {AgentManager, opts}) do
      {:ok, pid} ->
        ref = Process.monitor(pid)
        monitors = Map.put(monitors, ref, agent_name)
        Logger.info("Started agent #{agent_name} (project: #{project_name})")
        {:ok, pid, monitors}

      {:error, reason} ->
        Logger.error("Failed to start agent #{agent_name}: #{inspect(reason)}")
        {:error, reason}
    end
  end
end
