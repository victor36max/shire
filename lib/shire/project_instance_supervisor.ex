defmodule Shire.ProjectInstanceSupervisor do
  @moduledoc """
  Per-project supervisor. Starts the VM, Coordinator, and agent DynamicSupervisor
  for a single project. Uses `one_for_all` strategy: if the VM crashes,
  the Coordinator and all agents restart too.
  """
  use Supervisor

  def start_link(opts) do
    project_name = Keyword.fetch!(opts, :project_name)
    Supervisor.start_link(__MODULE__, project_name)
  end

  @impl true
  def init(project_name) do
    children = [
      {Shire.VirtualMachineImpl, project_name: project_name},
      {Shire.Agent.Coordinator, project_name: project_name},
      {DynamicSupervisor,
       name: {:via, Registry, {Shire.ProjectRegistry, {:agent_sup, project_name}}},
       strategy: :one_for_one}
    ]

    Supervisor.init(children, strategy: :one_for_all, max_restarts: 10, max_seconds: 300)
  end
end
