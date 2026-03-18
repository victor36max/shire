defmodule Shire.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    base_children = [
      ShireWeb.Telemetry,
      Shire.Repo,
      {DNSCluster, query: Application.get_env(:shire, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Shire.PubSub},
      {Registry, keys: :unique, name: Shire.AgentRegistry},
      {DynamicSupervisor, name: Shire.AgentSupervisor, strategy: :one_for_one}
    ]

    vm_children =
      if Application.get_env(:shire, :skip_vm_boot, false) do
        []
      else
        [
          %{
            id: :vm_supervisor,
            start:
              {Supervisor, :start_link,
               [
                 [Shire.VirtualMachineImpl],
                 [strategy: :one_for_one, max_restarts: 10, max_seconds: 300]
               ]},
            type: :supervisor
          },
          Shire.Agent.Coordinator
        ]
      end

    children =
      base_children ++
        vm_children ++
        [ShireWeb.Endpoint]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Shire.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    ShireWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
