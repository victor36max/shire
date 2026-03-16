defmodule SpriteAgents.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle: starts/stops AgentManagers via DynamicSupervisor,
  routes inter-agent messages.
  """
  use GenServer
  require Logger

  alias SpriteAgents.Agent.AgentManager
  alias SpriteAgents.Agents

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  def start_agent(agent_name) do
    GenServer.call(__MODULE__, {:start_agent, agent_name})
  end

  def stop_agent(agent_name) do
    case lookup(agent_name) do
      {:ok, pid} ->
        DynamicSupervisor.terminate_child(SpriteAgents.AgentSupervisor, pid)
        Logger.info("Stopped agent #{agent_name}")
        :ok

      {:error, :not_found} ->
        {:error, :not_found}
    end
  end

  def send_message(agent_name, text) do
    AgentManager.send_message(agent_name, text, :user)
  end

  def route_agent_message(from_agent, to_agent, text) do
    AgentManager.send_message(to_agent, text, {:agent, from_agent})
  end

  def lookup(agent_name) do
    case Registry.lookup(SpriteAgents.AgentRegistry, agent_name) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  def list_running do
    Registry.select(SpriteAgents.AgentRegistry, [
      {{:"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}
    ])
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{}}
  end

  @impl true
  def handle_call({:start_agent, agent_name}, _from, state) do
    case lookup(agent_name) do
      {:ok, _pid} ->
        {:reply, {:error, :already_running}, state}

      {:error, :not_found} ->
        token = Application.get_env(:sprite_agents, :sprites_token)

        if is_nil(token) do
          {:reply, {:error, :no_sprites_token}, state}
        else
          agent = Agents.get_agent_by_name!(agent_name)
          client = Sprites.new(token)

          case DynamicSupervisor.start_child(
                 SpriteAgents.AgentSupervisor,
                 {AgentManager, agent: agent, sprites_client: client}
               ) do
            {:ok, pid} ->
              Logger.info("Started agent #{agent_name} (pid: #{inspect(pid)})")
              {:reply, {:ok, pid}, state}

            {:error, reason} ->
              Logger.error("Failed to start agent #{agent_name}: #{inspect(reason)}")
              {:reply, {:error, reason}, state}
          end
        end
    end
  end
end
