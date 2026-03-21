defmodule Shire.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    base_children = [
      ShireWeb.Telemetry,
      Shire.Repo,
      {Oban, Application.fetch_env!(:shire, Oban)},
      {DNSCluster, query: Application.get_env(:shire, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Shire.PubSub},
      {Registry, keys: :unique, name: Shire.AgentRegistry},
      {Registry, keys: :unique, name: Shire.ProjectRegistry},
      {DynamicSupervisor, name: Shire.ProjectSupervisor, strategy: :one_for_one}
    ]

    vm_children =
      if Application.get_env(:shire, :skip_vm_boot, false) do
        []
      else
        [Shire.ProjectManager]
      end

    children =
      base_children ++
        vm_children ++
        [ShireWeb.Endpoint]

    opts = [strategy: :one_for_one, name: Shire.Supervisor]
    result = Supervisor.start_link(children, opts)

    case result do
      {:ok, _pid} ->
        oban_conf = Application.get_env(:shire, Oban, [])

        unless oban_conf[:testing] do
          Task.start(fn -> Shire.Schedules.ensure_jobs_enqueued() end)
        end

      _ ->
        :ok
    end

    result
  end

  @impl true
  def config_change(changed, _new, removed) do
    ShireWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
