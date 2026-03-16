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

  def start_agent(agent_id, opts \\ []) do
    GenServer.call(__MODULE__, {:start_agent, agent_id, opts})
  end

  def stop_agent(agent_id) do
    GenServer.call(__MODULE__, {:stop_agent, agent_id})
  end

  def send_message(agent_id, text) do
    AgentManager.send_message(agent_id, text, :user)
  end

  @doc """
  Called by AgentManager when it reaches :active phase.
  Triggers a debounced broadcast to update all running agents' peer lists.
  """
  def request_peers(agent_id) do
    GenServer.cast(__MODULE__, {:request_peers, agent_id})
  end

  def route_agent_message(from_agent_name, to_agent_name, text) do
    case lookup_by_name(to_agent_name) do
      {:ok, to_agent_id} ->
        try do
          AgentManager.send_message(to_agent_id, text, {:agent, from_agent_name})
        catch
          :exit, reason ->
            Logger.warning(
              "Failed to route message from #{from_agent_name} to #{to_agent_name}: #{inspect(reason)}"
            )

            broadcast_to_agent(
              from_agent_name,
              {:agent_event,
               %{
                 "type" => "agent_message_failed",
                 "payload" => %{"to_agent" => to_agent_name, "reason" => "delivery_failed"}
               }}
            )

            {:error, :delivery_failed}
        end

      {:error, :not_found} ->
        Logger.warning("Agent #{to_agent_name} not found for message from #{from_agent_name}")

        broadcast_to_agent(
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

  @doc "Returns all running agents as `[{agent_id, pid, agent_name}]`."
  def list_running_with_names do
    Registry.select(SpriteAgents.AgentRegistry, [
      {{:"$1", :"$2", :"$3"}, [], [{{:"$1", :"$2", :"$3"}}]}
    ])
  end

  @doc "Look up a running agent's id by its recipe name. Registry scan, no DB queries."
  def lookup_by_name(name) do
    result =
      Registry.select(SpriteAgents.AgentRegistry, [
        {{:"$1", :_, :"$2"}, [{:==, :"$2", name}], [:"$1"]}
      ])

    case result do
      [agent_id | _] -> {:ok, agent_id}
      [] -> {:error, :not_found}
    end
  end

  def broadcast_peers do
    do_broadcast_peers()
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    {:ok, %{monitors: %{}, broadcast_timer: nil}}
  end

  @impl true
  def handle_call({:start_agent, agent_id, _opts}, _from, state) do
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
              state = schedule_peer_broadcast(%{state | monitors: monitors})
              {:reply, {:ok, pid}, state}

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

        case Agents.get_agent(agent_id) do
          {:ok, agent} -> Agents.update_agent_status(agent, :created)
          {:error, :not_found} -> :ok
        end

        Logger.info("Stopped agent #{agent_id}")
        state = schedule_peer_broadcast(%{state | monitors: monitors})
        {:reply, :ok, state}

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

      state = schedule_peer_broadcast(%{state | monitors: monitors})
      {:noreply, state}
    else
      {:noreply, %{state | monitors: monitors}}
    end
  end

  @impl true
  def handle_info(:broadcast_peers, state) do
    do_broadcast_peers()
    {:noreply, %{state | broadcast_timer: nil}}
  end

  @impl true
  def handle_cast({:request_peers, _agent_id}, state) do
    state = ensure_monitors(state)
    state = schedule_peer_broadcast(state)
    {:noreply, state}
  end

  # --- Private ---

  defp do_broadcast_peers do
    running = list_running_with_names()

    agent_data =
      Enum.flat_map(running, fn {agent_id, pid, agent_name} ->
        case Agents.get_agent(agent_id) do
          {:ok, agent} ->
            recipe = Agent.parse_recipe!(agent)

            [
              %{
                pid: pid,
                name: agent_name,
                description: truncate(recipe["description"] || "", 200)
              }
            ]

          {:error, :not_found} ->
            Logger.warning("Agent #{agent_id} in Registry but missing from DB, skipping")
            []
        end
      end)

    peers = Enum.map(agent_data, &%{name: &1.name, description: &1.description})

    Enum.each(agent_data, fn %{pid: pid, name: name} ->
      filtered = Enum.reject(peers, fn p -> p.name == name end)
      GenServer.cast(pid, {:update_peers, filtered})
    end)
  end

  defp schedule_peer_broadcast(state) do
    if state.broadcast_timer, do: Process.cancel_timer(state.broadcast_timer)
    timer = Process.send_after(self(), :broadcast_peers, 500)
    %{state | broadcast_timer: timer}
  end

  defp broadcast_to_agent(name, message) do
    case lookup_by_name(name) do
      {:ok, agent_id} ->
        Phoenix.PubSub.broadcast(SpriteAgents.PubSub, "agent:#{agent_id}", message)

      _ ->
        :ok
    end
  end

  defp ensure_monitors(%{monitors: _, broadcast_timer: _} = state), do: state

  defp ensure_monitors(state) do
    state
    |> Map.put_new(:monitors, %{})
    |> Map.put_new(:broadcast_timer, nil)
  end

  defp truncate(text, max_length) when byte_size(text) <= max_length, do: text

  defp truncate(text, max_length) do
    truncated = String.slice(text, 0, max_length)

    case String.split(truncated, ~r/\s+/) |> Enum.drop(-1) do
      [] -> truncated
      words -> Enum.join(words, " ") <> "..."
    end
  end
end
