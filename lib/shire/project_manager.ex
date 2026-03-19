defmodule Shire.ProjectManager do
  @moduledoc """
  Manages the lifecycle of projects (Sprite VMs).
  Each project IS a VM. Projects are backed by DB records with UUID primary keys.
  The VM name is derived from the project's UUID.
  """
  use GenServer
  require Logger

  alias Shire.Projects
  alias Shire.Projects.Project

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  @doc "Lists all projects from the DB, merged with runtime status."
  def list_projects do
    GenServer.call(__MODULE__, :list_projects, 30_000)
  end

  @doc "Creates a new project: inserts DB record and starts the supervision subtree."
  def create_project(name) when is_binary(name) do
    GenServer.call(__MODULE__, {:create_project, name}, 120_000)
  end

  @doc "Destroys a project: stops the supervision subtree, destroys the VM, and deletes the DB record."
  def destroy_project(project_id) when is_binary(project_id) do
    GenServer.call(__MODULE__, {:destroy_project, project_id}, 60_000)
  end

  @doc "Renames a project (DB-only, no VM change needed since VM name uses UUID)."
  def rename_project(project_id, new_name) when is_binary(project_id) and is_binary(new_name) do
    GenServer.call(__MODULE__, {:rename_project, project_id, new_name}, 15_000)
  end

  @doc "Returns the Coordinator pid for a project."
  def lookup_coordinator(project_id) do
    case Registry.lookup(Shire.ProjectRegistry, {:coordinator, project_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @doc "Returns the VirtualMachineImpl pid for a project."
  def lookup_vm(project_id) do
    case Registry.lookup(Shire.ProjectRegistry, {:vm, project_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{projects: %{}, refs: %{}}, {:continue, :discover}}
  end

  @impl true
  def handle_continue(:discover, state) do
    db_projects = Projects.list_projects()

    projects =
      Enum.reduce(db_projects, state.projects, fn project, acc ->
        case start_project_subtree(project.id) do
          {:ok, pid} ->
            Process.monitor(pid)
            Map.put(acc, project.id, pid)

          {:error, reason} ->
            Logger.error(
              "Failed to start project #{project.name} (#{project.id}): #{inspect(reason)}"
            )

            acc
        end
      end)

    Logger.info("Discovered #{map_size(projects)} project(s)")
    {:noreply, %{state | projects: projects}}
  end

  @impl true
  def handle_call(:list_projects, _from, state) do
    projects =
      Projects.list_projects()
      |> Enum.map(fn project ->
        pid = Map.get(state.projects, project.id)

        status =
          cond do
            pid && Process.alive?(pid) -> :running
            pid -> :error
            true -> :stopped
          end

        %{id: project.id, name: project.name, status: status}
      end)

    {:reply, projects, state}
  end

  @impl true
  def handle_call({:create_project, name}, _from, state) do
    unless Shire.Slug.valid?(name) do
      {:reply, {:error, :invalid_name}, state}
    else
      # Check DB first
      if Projects.get_project_by_name(name) do
        {:reply, {:error, :already_exists}, state}
      else
        case Projects.create_project(name) do
          {:ok, project} ->
            case start_project_subtree(project.id) do
              {:ok, pid} ->
                Process.monitor(pid)
                projects = Map.put(state.projects, project.id, pid)

                Phoenix.PubSub.broadcast(
                  Shire.PubSub,
                  "projects:lobby",
                  {:project_created, project}
                )

                {:reply, {:ok, project}, %{state | projects: projects}}

              {:error, reason} ->
                # Subtree failed — clean up DB record
                Projects.delete_project(project)
                {:reply, {:error, reason}, state}
            end

          {:error, changeset} ->
            {:reply, {:error, changeset}, state}
        end
      end
    end
  end

  @impl true
  def handle_call({:destroy_project, project_id}, _from, state) do
    case Map.pop(state.projects, project_id) do
      {nil, _} ->
        {:reply, {:error, :not_found}, state}

      {pid, projects} ->
        # Stop the supervision subtree first
        DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, pid)

        # Destroy the underlying VM
        case @vm.destroy_vm(project_id) do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Failed to destroy VM for #{project_id}: #{inspect(reason)}")
        end

        # Delete DB record (cascades to agents and messages)
        case Projects.get_project_by_id(project_id) do
          %Project{} = project -> Projects.delete_project(project)
          nil -> :ok
        end

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "projects:lobby",
          {:project_destroyed, project_id}
        )

        {:reply, :ok, %{state | projects: projects}}
    end
  end

  @impl true
  def handle_call({:rename_project, project_id, new_name}, _from, state) do
    case Projects.get_project_by_id(project_id) do
      %Project{} = project ->
        case Projects.rename_project(project, new_name) do
          {:ok, updated} ->
            Phoenix.PubSub.broadcast(
              Shire.PubSub,
              "projects:lobby",
              {:project_renamed, updated}
            )

            {:reply, {:ok, updated}, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      nil ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    case Enum.find(state.projects, fn {_id, p} -> p == pid end) do
      {project_id, _pid} ->
        Logger.warning(
          "Project #{project_id} supervisor went down, removing from tracked projects"
        )

        projects = Map.delete(state.projects, project_id)

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "projects:lobby",
          {:project_destroyed, project_id}
        )

        {:noreply, %{state | projects: projects}}

      nil ->
        {:noreply, state}
    end
  end

  # --- Private ---

  defp start_project_subtree(project_id) do
    DynamicSupervisor.start_child(
      Shire.ProjectSupervisor,
      {Shire.ProjectInstanceSupervisor, project_id: project_id}
    )
  end
end
