defmodule Shire.ProjectManager do
  @moduledoc """
  Manages the lifecycle of projects (Sprite VMs).
  Each project IS a VM. Projects are discovered via the VM module's `list_vms/0`.
  No DB table — the Sprites API is the source of truth.
  """
  use GenServer
  require Logger

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  @doc "Lists all projects by querying the Sprites API."
  def list_projects do
    GenServer.call(__MODULE__, :list_projects, 30_000)
  end

  @doc "Creates a new project: starts the supervision subtree (VM is created on init)."
  def create_project(name) when is_binary(name) do
    GenServer.call(__MODULE__, {:create_project, name}, 120_000)
  end

  @doc "Destroys a project: stops the supervision subtree and destroys the Sprite VM."
  def destroy_project(name) when is_binary(name) do
    GenServer.call(__MODULE__, {:destroy_project, name}, 60_000)
  end

  @doc "Returns the Coordinator pid for a project."
  def lookup_coordinator(project_name) do
    case Registry.lookup(Shire.ProjectRegistry, {:coordinator, project_name}) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  @doc "Returns the VirtualMachineImpl pid for a project."
  def lookup_vm(project_name) do
    case Registry.lookup(Shire.ProjectRegistry, {:vm, project_name}) do
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
    prefix = prefix()

    case @vm.list_vms() do
      {:ok, vm_names} ->
        projects =
          Enum.reduce(vm_names, state.projects, fn vm_name, acc ->
            if String.starts_with?(vm_name, prefix) do
              project_name = String.replace_prefix(vm_name, prefix, "")

              case start_project_subtree(project_name) do
                {:ok, pid} ->
                  Process.monitor(pid)
                  Map.put(acc, project_name, pid)

                {:error, reason} ->
                  Logger.error("Failed to start project #{project_name}: #{inspect(reason)}")
                  acc
              end
            else
              acc
            end
          end)

        Logger.info("Discovered #{map_size(projects)} project(s)")
        {:noreply, %{state | projects: projects}}

      {:error, reason} ->
        Logger.error("Failed to list VMs: #{inspect(reason)}")
        {:noreply, state}
    end
  end

  @impl true
  def handle_call(:list_projects, _from, state) do
    projects =
      Enum.map(state.projects, fn {name, pid} ->
        status =
          if Process.alive?(pid) do
            :running
          else
            :error
          end

        %{name: name, status: status}
      end)

    {:reply, projects, state}
  end

  @impl true
  def handle_call({:create_project, name}, _from, state) do
    if Map.has_key?(state.projects, name) do
      {:reply, {:error, :already_exists}, state}
    else
      # VirtualMachineImpl.init will create-or-connect to the VM
      case start_project_subtree(name) do
        {:ok, pid} ->
          Process.monitor(pid)
          projects = Map.put(state.projects, name, pid)

          Phoenix.PubSub.broadcast(
            Shire.PubSub,
            "projects:lobby",
            {:project_created, name}
          )

          {:reply, {:ok, pid}, %{state | projects: projects}}

        {:error, reason} ->
          {:reply, {:error, reason}, state}
      end
    end
  end

  @impl true
  def handle_call({:destroy_project, name}, _from, state) do
    case Map.pop(state.projects, name) do
      {nil, _} ->
        {:reply, {:error, :not_found}, state}

      {pid, projects} ->
        # Stop the supervision subtree first
        DynamicSupervisor.terminate_child(Shire.ProjectSupervisor, pid)

        # Destroy the underlying VM
        case @vm.destroy_vm(name) do
          :ok ->
            :ok

          {:error, reason} ->
            Logger.warning("Failed to destroy VM for #{name}: #{inspect(reason)}")
        end

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "projects:lobby",
          {:project_destroyed, name}
        )

        {:reply, :ok, %{state | projects: projects}}
    end
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    case Enum.find(state.projects, fn {_name, p} -> p == pid end) do
      {name, _pid} ->
        Logger.warning("Project #{name} supervisor went down, removing from tracked projects")
        projects = Map.delete(state.projects, name)

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "projects:lobby",
          {:project_destroyed, name}
        )

        {:noreply, %{state | projects: projects}}

      nil ->
        {:noreply, state}
    end
  end

  # --- Private ---

  defp prefix do
    Application.get_env(:shire, :sprite_vm_prefix, "shire-")
  end

  defp start_project_subtree(project_name) do
    DynamicSupervisor.start_child(
      Shire.ProjectSupervisor,
      {Shire.ProjectInstanceSupervisor, project_name: project_name}
    )
  end
end
