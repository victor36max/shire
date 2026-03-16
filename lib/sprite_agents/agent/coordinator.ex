defmodule SpriteAgents.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle: starts/stops AgentManagers via DynamicSupervisor,
  routes inter-agent messages.
  """
  use GenServer
  require Logger

  alias SpriteAgents.Agent.AgentManager
  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  def start_agent(agent_id) do
    GenServer.call(__MODULE__, {:start_agent, agent_id})
  end

  def stop_agent(agent_id) do
    GenServer.call(__MODULE__, {:stop_agent, agent_id})
  end

  def send_message(agent_id, text) do
    AgentManager.send_message(agent_id, text, :user)
  end

  def route_agent_message(from_agent_name, to_agent_name, text) do
    # Resolve target agent by name (from peers.json)
    to_agent_id = find_running_agent_id_by_name(to_agent_name)

    case to_agent_id && lookup(to_agent_id) do
      {:ok, _pid} ->
        try do
          AgentManager.send_message(to_agent_id, text, {:agent, from_agent_name})
        catch
          :exit, reason ->
            Logger.warning(
              "Failed to route message from #{from_agent_name} to #{to_agent_name}: #{inspect(reason)}"
            )

            broadcast_to_agent_by_name(
              from_agent_name,
              {:agent_event,
               %{
                 "type" => "agent_message_failed",
                 "payload" => %{"to_agent" => to_agent_name, "reason" => "delivery_failed"}
               }}
            )

            {:error, :delivery_failed}
        end

      _ ->
        Logger.warning("Agent #{to_agent_name} not found for message from #{from_agent_name}")

        broadcast_to_agent_by_name(
          from_agent_name,
          {:agent_event,
           %{
             "type" => "agent_message_failed",
             "payload" => %{"to_agent" => to_agent_name, "reason" => "not_running"}
           }}
        )

        {:error, :not_running}
    end
  end

  def lookup(agent_id) do
    case Registry.lookup(SpriteAgents.AgentRegistry, agent_id) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  def list_running do
    Registry.select(SpriteAgents.AgentRegistry, [
      {{:"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}
    ])
  end

  def broadcast_peers do
    running = list_running()

    peers =
      Enum.map(running, fn {agent_id, _pid} ->
        agent = Agents.get_agent!(agent_id)
        recipe = Agent.parse_recipe!(agent)
        %{name: recipe["name"], description: truncate(recipe["description"] || "", 200)}
      end)

    Enum.each(running, fn {agent_id, pid} ->
      agent = Agents.get_agent!(agent_id)
      name = Agent.recipe_name(agent)
      filtered = Enum.reject(peers, fn p -> p.name == name end)
      GenServer.cast(pid, {:update_peers, filtered})
    end)
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{monitors: %{}}}
  end

  @impl true
  def handle_call({:start_agent, agent_id}, _from, state) do
    state = ensure_monitors(state)

    case lookup(agent_id) do
      {:ok, _pid} ->
        {:reply, {:error, :already_running}, state}

      {:error, :not_found} ->
        token = Application.get_env(:sprite_agents, :sprites_token)

        if is_nil(token) do
          {:reply, {:error, :no_sprites_token}, state}
        else
          agent = Agents.get_agent!(agent_id)
          client = Sprites.new(token)

          case DynamicSupervisor.start_child(
                 SpriteAgents.AgentSupervisor,
                 {AgentManager, agent: agent, sprites_client: client}
               ) do
            {:ok, pid} ->
              ref = Process.monitor(pid)
              monitors = Map.put(state.monitors, ref, agent_id)
              Logger.info("Started agent #{agent_id} (pid: #{inspect(pid)})")
              Task.start(fn -> broadcast_peers() end)
              {:reply, {:ok, pid}, %{state | monitors: monitors}}

            {:error, reason} ->
              Logger.error("Failed to start agent #{agent_id}: #{inspect(reason)}")
              {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:stop_agent, agent_id}, _from, state) do
    state = ensure_monitors(state)

    case lookup(agent_id) do
      {:ok, pid} ->
        DynamicSupervisor.terminate_child(SpriteAgents.AgentSupervisor, pid)

        # Clean up monitor for this pid
        {ref, monitors} =
          Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, aid} ->
            if aid == agent_id, do: {ref, Map.delete(state.monitors, ref)}
          end)

        if ref, do: Process.demonitor(ref, [:flush])

        try do
          agent = Agents.get_agent!(agent_id)
          Agents.update_agent_status(agent, :created)
        rescue
          _ -> :ok
        end

        Logger.info("Stopped agent #{agent_id}")
        Task.start(fn -> broadcast_peers() end)
        {:reply, :ok, %{state | monitors: monitors}}

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    state = ensure_monitors(state)
    {agent_id, monitors} = Map.pop(state.monitors, ref)

    if agent_id do
      Logger.warning("Agent #{agent_id} process died: #{inspect(reason)}")

      try do
        agent = Agents.get_agent!(agent_id)
        Agents.update_agent_status(agent, :crashed)

        Phoenix.PubSub.broadcast(
          SpriteAgents.PubSub,
          "agent:#{agent_id}",
          {:status, :crashed}
        )
      rescue
        _ -> :ok
      end

      Task.start(fn -> broadcast_peers() end)
    end

    {:noreply, %{state | monitors: monitors}}
  end

  # --- Private ---

  defp find_running_agent_id_by_name(name) do
    running = list_running()

    Enum.find_value(running, fn {agent_id, _pid} ->
      agent = Agents.get_agent!(agent_id)

      if Agent.recipe_name(agent) == name do
        agent_id
      end
    end)
  end

  defp broadcast_to_agent_by_name(name, message) do
    agent_id = find_running_agent_id_by_name(name)

    if agent_id do
      Phoenix.PubSub.broadcast(SpriteAgents.PubSub, "agent:#{agent_id}", message)
    end
  end

  defp ensure_monitors(%{monitors: _} = state), do: state
  defp ensure_monitors(state), do: Map.put(state, :monitors, %{})

  defp truncate(text, max_length) when byte_size(text) <= max_length, do: text

  defp truncate(text, max_length) do
    truncated = String.slice(text, 0, max_length)

    case String.split(truncated, ~r/\s+/) |> Enum.drop(-1) do
      [] -> truncated
      words -> Enum.join(words, " ") <> "..."
    end
  end
end
