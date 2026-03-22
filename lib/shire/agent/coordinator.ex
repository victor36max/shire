defmodule Shire.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle on a project's Sprite VM.
  Each project gets its own Coordinator, registered via ProjectRegistry.
  Starts/stops AgentManagers via the project-scoped DynamicSupervisor.
  """
  use GenServer
  require Logger

  alias Shire.Agents
  alias Shire.Agent.AgentManager
  alias Shire.Workspace

  def start_link(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    GenServer.start_link(__MODULE__, opts, name: via(project_id))
  end

  defp via(project_id) do
    {:via, Registry, {Shire.ProjectRegistry, {:coordinator, project_id}}}
  end

  # --- Public API ---

  @doc "Returns the current status for an agent (defaults to :created if not tracked)."
  def agent_status(project_id, agent_id) do
    GenServer.call(via(project_id), {:agent_status, agent_id})
  end

  @doc "Returns a map of `%{agent_id => status}` for the given agent IDs."
  def agent_statuses(project_id, agent_ids) do
    GenServer.call(via(project_id), {:agent_statuses, agent_ids})
  end

  @doc "Creates a new agent: inserts DB record, sets up VM workspace, and starts runner."
  def create_agent(project_id, attrs) do
    GenServer.call(via(project_id), {:create_agent, attrs}, 60_000)
  end

  @doc "Updates an agent's recipe.yaml on the VM."
  def update_agent(project_id, agent_id, attrs) do
    GenServer.call(via(project_id), {:update_agent, agent_id, attrs}, 30_000)
  end

  def delete_agent(project_id, agent_id) do
    GenServer.call(via(project_id), {:delete_agent, agent_id}, 30_000)
  end

  def restart_agent(project_id, agent_id) do
    GenServer.call(via(project_id), {:restart_agent, agent_id}, 60_000)
  end

  def send_message(project_id, agent_id, text) do
    AgentManager.send_message(project_id, agent_id, text, :user)
  end

  @doc "Look up a running agent's pid by ID within a project."
  def lookup(project_id, agent_id) do
    case Registry.lookup(Shire.AgentRegistry, {project_id, agent_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @doc "Returns all running agent IDs for a project."
  def list_running(project_id) do
    Registry.select(Shire.AgentRegistry, [
      {{{project_id, :"$1"}, :"$2", :_}, [], [:"$1"]}
    ])
  end

  @doc """
  Lists agents from the DB for this project, merged with runtime statuses.
  """
  def list_agents(project_id) do
    GenServer.call(via(project_id), :list_agents, 30_000)
  end

  @doc "Gets an agent's details: DB record + recipe.yaml from VM."
  def get_agent(project_id, agent_id) do
    GenServer.call(via(project_id), {:get_agent, agent_id}, 15_000)
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    project_id = Keyword.fetch!(opts, :project_id)

    Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:agents:lobby")
    Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{project_id}:vm")

    state = %{
      project_id: project_id,
      monitors: %{},
      statuses: %{}
    }

    {:ok, state, {:continue, :deploy_and_scan}}
  end

  @impl true
  def handle_continue(:deploy_and_scan, state) do
    case Shire.WorkspaceSettings.bootstrap_workspace(state.project_id) do
      :ok -> :ok
      {:error, reason} -> Logger.error("Bootstrap failed: #{inspect(reason)}")
    end

    case deploy_runner(state.project_id) do
      :ok -> :ok
      {:error, reason} -> Logger.error("Runner deployment failed: #{inspect(reason)}")
    end

    # Write peers.yaml before starting any agents
    write_peers_yaml(state.project_id)

    # Get agents from DB and start managers for those with folders on VM
    db_agents = Agents.list_agents(state.project_id)

    monitors =
      Enum.reduce(db_agents, state.monitors, fn agent, acc ->
        case start_agent_manager(state.project_id, agent.id, agent.name, acc) do
          {:ok, _pid, updated_monitors} -> updated_monitors
          {:error, _} -> acc
        end
      end)

    Logger.info("Project #{state.project_id}: started #{map_size(monitors)} agents")

    {:noreply, %{state | monitors: monitors}}
  end

  @impl true
  def handle_call({:create_agent, %{"name" => name, "recipe_yaml" => recipe_yaml}}, _from, state) do
    unless Shire.Slug.valid?(name) do
      {:reply, {:error, :invalid_name}, state}
    else
      case Agents.create_agent_with_vm(state.project_id, name, recipe_yaml) do
        {:ok, agent} ->
          # Post-commit: write peers.yaml and start agent manager
          write_peers_yaml(state.project_id)

          case start_agent_manager(state.project_id, agent.id, agent.name, state.monitors) do
            {:ok, pid, monitors} ->
              Phoenix.PubSub.broadcast(
                Shire.PubSub,
                "project:#{state.project_id}:agents:lobby",
                {:agent_created, agent.id}
              )

              {:reply, {:ok, pid}, %{state | monitors: monitors}}

            {:error, reason} ->
              {:reply, {:error, reason}, state}
          end

        {:error, %Ecto.Changeset{} = changeset} ->
          unique_error? =
            Enum.any?(changeset.errors, fn {_field, {_msg, opts}} ->
              opts[:constraint] == :unique
            end)

          if unique_error? do
            {:reply, {:error, :already_exists}, state}
          else
            {:reply, {:error, changeset}, state}
          end

        {:error, reason} ->
          {:reply, {:error, reason}, state}
      end
    end
  end

  @impl true
  def handle_call({:create_agent, _attrs}, _from, state) do
    {:reply, {:error, :missing_name_or_recipe}, state}
  end

  @impl true
  def handle_call({:update_agent, agent_id, %{"recipe_yaml" => recipe_yaml}}, _from, state) do
    case Agents.get_agent(agent_id) do
      {:ok, agent} ->
        new_name = extract_name_from_yaml(recipe_yaml)

        # Update DB name if it changed
        name_changed = new_name && new_name != agent.name

        if name_changed && !Shire.Slug.valid?(new_name) do
          {:reply, {:error, :invalid_name}, state}
        else
          with :ok <- maybe_rename(agent, new_name, name_changed),
               :ok <-
                 vm().write(
                   state.project_id,
                   Path.join(Workspace.agent_dir(state.project_id, agent_id), "recipe.yaml"),
                   recipe_yaml
                 ) do
            case lookup(state.project_id, agent_id) do
              {:ok, _pid} -> AgentManager.restart(state.project_id, agent_id)
              {:error, :not_found} -> :ok
            end

            # Rewrite peers.yaml in case name or description changed
            write_peers_yaml(state.project_id)

            event =
              if name_changed,
                do: {:agent_renamed, agent_id, agent.name, new_name},
                else: {:agent_updated, agent_id}

            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{state.project_id}:agents:lobby",
              event
            )

            # Also broadcast on agent-specific topic so show page gets the event
            if name_changed do
              Phoenix.PubSub.broadcast(
                Shire.PubSub,
                "project:#{state.project_id}:agent:#{agent_id}",
                event
              )
            end

            {:reply, :ok, state}
          else
            {:error, reason} -> {:reply, {:error, reason}, state}
          end
        end

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_call({:update_agent, _agent_id, _attrs}, _from, state) do
    {:reply, {:error, :missing_recipe_yaml}, state}
  end

  @impl true
  def handle_call({:delete_agent, agent_id}, _from, state) do
    # Stop the process if running
    case lookup(state.project_id, agent_id) do
      {:ok, pid} ->
        agent_sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, state.project_id}}}
        DynamicSupervisor.terminate_child(agent_sup, pid)

      {:error, :not_found} ->
        :ok
    end

    # Clean up monitor
    {ref, monitors} =
      Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, id} ->
        if id == agent_id, do: {ref, Map.delete(state.monitors, ref)}
      end)

    if ref, do: Process.demonitor(ref, [:flush])

    # Delete agent (Multi: rm folder + delete DB record)
    case Agents.get_agent(agent_id) do
      {:ok, agent} ->
        case Agents.delete_agent_with_vm(state.project_id, agent) do
          :ok ->
            # Post-commit: rewrite peers.yaml
            write_peers_yaml(state.project_id)

            statuses = Map.delete(state.statuses, agent_id)
            Logger.info("Deleted agent #{agent_id}")

            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "project:#{state.project_id}:agents:lobby",
              {:agent_deleted, agent_id}
            )

            {:reply, :ok, %{state | monitors: monitors, statuses: statuses}}

          {:error, reason} ->
            {:reply, {:error, reason}, %{state | monitors: monitors}}
        end

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, %{state | monitors: monitors}}
    end
  end

  @impl true
  def handle_call({:restart_agent, agent_id}, _from, state) do
    case lookup(state.project_id, agent_id) do
      {:ok, _pid} ->
        case AgentManager.restart(state.project_id, agent_id) do
          :ok ->
            Logger.info("Restarting agent #{agent_id}")
            {:reply, :ok, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      {:error, :not_found} ->
        # Get agent name from DB
        case Agents.get_agent(agent_id) do
          {:ok, agent} ->
            case start_agent_manager(state.project_id, agent.id, agent.name, state.monitors) do
              {:ok, _pid, monitors} ->
                Logger.info("Started agent #{agent_id} (was not running)")
                {:reply, :ok, %{state | monitors: monitors}}

              {:error, reason} ->
                {:reply, {:error, reason}, state}
            end

          {:error, :not_found} ->
            {:reply, {:error, :not_found}, state}
        end
    end
  end

  @impl true
  def handle_call({:agent_status, agent_id}, _from, state) do
    {:reply, Map.get(state.statuses, agent_id, :created), state}
  end

  @impl true
  def handle_call({:agent_statuses, agent_ids}, _from, state) do
    result = Map.new(agent_ids, fn id -> {id, Map.get(state.statuses, id, :created)} end)
    {:reply, result, state}
  end

  @impl true
  def handle_call(:list_agents, _from, state) do
    agents =
      Agents.list_agents(state.project_id)
      |> Enum.map(fn agent ->
        status = Map.get(state.statuses, agent.id, :created)
        %{id: agent.id, name: agent.name, status: status}
      end)

    {:reply, agents, state}
  end

  @impl true
  def handle_call({:get_agent, agent_id}, _from, state) do
    case Agents.get_agent(agent_id) do
      {:ok, agent} ->
        recipe = read_agent_recipe(state.project_id, agent_id)
        status = Map.get(state.statuses, agent_id, :created)

        agent_data = %{
          id: agent.id,
          name: agent.name,
          description: recipe["description"],
          harness: recipe["harness"] || "claude_code",
          model: recipe["model"],
          system_prompt: recipe["system_prompt"],
          skills: recipe["skills"] || [],
          status: status
        }

        {:reply, {:ok, agent_data}, state}

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    {agent_id, monitors} = Map.pop(state.monitors, ref)

    if agent_id do
      Logger.warning("Agent #{agent_id} process died: #{inspect(reason)}")

      statuses = Map.put(state.statuses, agent_id, :crashed)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_id}:agent:#{agent_id}",
        {:status, :crashed}
      )

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_id}:agents:lobby",
        {:agent_status, agent_id, :crashed}
      )

      {:noreply, %{state | monitors: monitors, statuses: statuses}}
    else
      {:noreply, %{state | monitors: monitors}}
    end
  end

  @impl true
  def handle_info({:agent_status, agent_id, status}, state) do
    statuses = Map.put(state.statuses, agent_id, status)
    {:noreply, %{state | statuses: statuses}}
  end

  @impl true
  def handle_info({:agent_busy, _agent_id, _active}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:agent_created, _id}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:vm_woke_up, _project_id}, state) do
    # Notify project lobby so dashboard status updates
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "projects:lobby",
      {:project_status_changed, state.project_id}
    )

    idle_agents =
      Enum.filter(state.statuses, fn {_id, status} -> status == :idle end)

    if idle_agents != [] do
      Logger.info(
        "VM woke up — restarting #{length(idle_agents)} idle agent(s) for project #{state.project_id}"
      )

      Enum.each(idle_agents, fn {agent_id, _} ->
        project_id = state.project_id

        Task.start(fn ->
          case lookup(project_id, agent_id) do
            {:ok, _pid} -> AgentManager.auto_restart(project_id, agent_id)
            {:error, :not_found} -> :ok
          end
        end)
      end)
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:vm_went_idle, _project_id}, state) do
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "projects:lobby",
      {:project_status_changed, state.project_id}
    )

    {:noreply, state}
  end

  @impl true
  def handle_info({:vm_unreachable, _project_id}, state) do
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "projects:lobby",
      {:project_status_changed, state.project_id}
    )

    {:noreply, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("Coordinator unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # --- Private ---

  defp deploy_runner(project_id) do
    source_dir = Application.app_dir(:shire, "priv/sprite")
    ws_runner_dir = Workspace.runner_dir(project_id)

    content = File.read!(Path.join(source_dir, "agent-runner.ts"))

    with :ok <- vm().write(project_id, Path.join(ws_runner_dir, "agent-runner.ts"), content),
         :ok <- deploy_harness(project_id, source_dir),
         {:ok, _} <-
           vm().cmd(project_id, "bash", ["-c", "cd #{ws_runner_dir} && bun install"],
             timeout: 120_000
           ) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp deploy_harness(project_id, source_dir) do
    harness_dir = Path.join(source_dir, "harness")
    ws_harness_dir = Path.join(Workspace.runner_dir(project_id), "harness")

    if File.dir?(harness_dir) do
      with :ok <- vm().mkdir_p(project_id, ws_harness_dir) do
        Enum.reduce_while(File.ls!(harness_dir), :ok, fn file, :ok ->
          content = File.read!(Path.join(harness_dir, file))

          case vm().write(project_id, Path.join(ws_harness_dir, file), content) do
            :ok -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)
      end
    else
      :ok
    end
  end

  defp read_agent_recipe(project_id, agent_id) do
    path = Path.join(Workspace.agent_dir(project_id, agent_id), "recipe.yaml")

    case vm().read(project_id, path) do
      {:ok, content} ->
        case YamlElixir.read_from_string(content) do
          {:ok, recipe} ->
            recipe

          {:error, reason} ->
            Logger.warning(
              "Failed to parse recipe YAML for agent #{agent_id}: #{inspect(reason)}"
            )

            %{}
        end

      {:error, _} ->
        %{}
    end
  end

  defp extract_name_from_yaml(recipe_yaml) do
    case YamlElixir.read_from_string(recipe_yaml) do
      {:ok, %{"name" => name}} when is_binary(name) -> name
      _ -> nil
    end
  end

  defp maybe_rename(_agent, _new_name, false), do: :ok

  defp maybe_rename(agent, new_name, true) do
    case Agents.rename_agent(agent, new_name) do
      {:ok, _updated} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_agent_manager(project_id, agent_id, agent_name, monitors) do
    opts = [project_id: project_id, agent_id: agent_id, agent_name: agent_name]
    agent_sup = {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}}

    case DynamicSupervisor.start_child(agent_sup, {AgentManager, opts}) do
      {:ok, pid} ->
        ref = Process.monitor(pid)
        monitors = Map.put(monitors, ref, agent_id)
        Logger.info("Started agent #{agent_name} (#{agent_id}) in project #{project_id}")
        {:ok, pid, monitors}

      {:error, reason} ->
        Logger.error("Failed to start agent #{agent_name} (#{agent_id}): #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc false
  def write_peers_yaml(project_id) do
    agents = Agents.list_agents(project_id)

    peers =
      Enum.map(agents, fn agent ->
        recipe = read_agent_recipe(project_id, agent.id)

        %{
          "id" => agent.id,
          "name" => agent.name,
          "description" => recipe["description"] || ""
        }
      end)

    yaml_content =
      case peers do
        [] ->
          "# No agents configured\n"

        _ ->
          Enum.map_join(peers, "\n", fn peer ->
            "- id: #{peer["id"]}\n  name: #{Jason.encode!(peer["name"])}\n  description: #{Jason.encode!(peer["description"])}"
          end) <> "\n"
      end

    case vm().write(project_id, Workspace.peers_path(project_id), yaml_content) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Failed to write peers.yaml: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineImpl)
end
