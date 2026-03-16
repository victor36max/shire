defmodule SpriteAgents.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      SpriteAgentsWeb.Telemetry,
      SpriteAgents.Vault,
      SpriteAgents.Repo,
      {DNSCluster, query: Application.get_env(:sprite_agents, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: SpriteAgents.PubSub},
      {Registry, keys: :unique, name: SpriteAgents.AgentRegistry},
      {DynamicSupervisor, name: SpriteAgents.AgentSupervisor, strategy: :one_for_one},
      SpriteAgents.Agent.DriveSync,
      SpriteAgents.Agent.Coordinator,
      # Start a worker by calling: SpriteAgents.Worker.start_link(arg)
      # {SpriteAgents.Worker, arg},
      # Start to serve requests, typically the last entry
      SpriteAgentsWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: SpriteAgents.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    SpriteAgentsWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
