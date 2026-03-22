defmodule Shire.ProjectInstanceSupervisor do
  @moduledoc """
  Per-project supervisor. Starts the VM, Coordinator, and agent DynamicSupervisor
  for a single project. Uses `one_for_all` strategy: if the VM crashes,
  the Coordinator and all agents restart too.
  """
  use Supervisor

  def start_link(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    Supervisor.start_link(__MODULE__, project_id)
  end

  @impl true
  def init(project_id) do
    vm_module = Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)

    vm_children =
      if function_exported?(vm_module, :child_spec, 1) do
        [{vm_module, project_id: project_id}]
      else
        []
      end

    children =
      vm_children ++
        [
          {Shire.Agent.Coordinator, project_id: project_id},
          {DynamicSupervisor,
           name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
           strategy: :one_for_one}
        ]

    Supervisor.init(children, strategy: :one_for_all, max_restarts: 10, max_seconds: 300)
  end
end
