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
    children = [
      {Shire.VirtualMachineImpl, project_id: project_id},
      {Shire.Agent.Coordinator, project_id: project_id},
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_id}}},
       strategy: :one_for_one}
    ]

    Supervisor.init(children, strategy: :one_for_all, max_restarts: 10, max_seconds: 300)
  end
end
