defmodule Shire.Agent.Coordinator do
  @moduledoc """
  Manages agent lifecycle: starts/stops AgentManagers via DynamicSupervisor,
  routes inter-agent messages.
  """
  use GenServer
  require Logger

  alias Shire.Agent.AgentManager
  alias Shire.Agents
  alias Shire.Agents.Agent

  @sprite_prefix Application.compile_env(:shire, :sprite_prefix, "agent")

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API ---

  def start_agent(agent_id, opts \\ []) do
    GenServer.call(__MODULE__, {:start_agent, agent_id, opts})
  end

  @doc "Returns the current status for an agent (defaults to :created if not tracked)."
  def agent_status(agent_id) do
    GenServer.call(__MODULE__, {:agent_status, agent_id})
  end

  @doc "Returns a map of `%{agent_id => status}` for the given agent IDs."
  def agent_statuses(agent_ids) do
    GenServer.call(__MODULE__, {:agent_statuses, agent_ids})
  end

  @doc "Called by AgentManager to notify status changes."
  def notify_status(agent_id, status) do
    GenServer.cast(__MODULE__, {:agent_status_changed, agent_id, status})
  end

  def kill_agent(agent_id) do
    GenServer.call(__MODULE__, {:kill_agent, agent_id})
  end

  def restart_agent(agent_id) do
    GenServer.call(__MODULE__, {:restart_agent, agent_id}, 60_000)
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
          result = AgentManager.send_message(to_agent_id, text, {:agent, from_agent_name})

          Agents.create_message(%{
            agent_id: to_agent_id,
            role: "inter_agent",
            content: %{
              "text" => text,
              "from_agent" => from_agent_name,
              "to_agent" => to_agent_name
            }
          })

          result
        catch
          :exit, reason ->
            Logger.warning(
              "Failed to route message from #{from_agent_name} to #{to_agent_name}: #{inspect(reason)}"
            )

            broadcast_agent_event(
              from_agent_name,
              %{
                "type" => "agent_message_failed",
                "payload" => %{"to_agent" => to_agent_name, "reason" => "delivery_failed"}
              }
            )

            {:error, :delivery_failed}
        end

      {:error, :not_found} ->
        Logger.warning("Agent #{to_agent_name} not found for message from #{from_agent_name}")

        broadcast_agent_event(
          from_agent_name,
          %{
            "type" => "agent_message_failed",
            "payload" => %{"to_agent" => to_agent_name, "reason" => "not_running"}
          }
        )

        {:error, :not_running}
    end
  end

  def lookup(agent_id) do
    case Registry.lookup(Shire.AgentRegistry, agent_id) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  def list_running do
    Registry.select(Shire.AgentRegistry, [
      {{:"$1", :"$2", :_}, [{:is_integer, :"$1"}], [{{:"$1", :"$2"}}]}
    ])
  end

  @doc "Returns all running agents as `[{agent_id, pid, agent_name}]`."
  def list_running_with_names do
    Registry.select(Shire.AgentRegistry, [
      {{:"$1", :"$2", :"$3"}, [{:is_integer, :"$1"}], [{{:"$1", :"$2", :"$3"}}]}
    ])
  end

  @doc "Look up a running agent's id by its recipe name. Registry scan, no DB queries."
  def lookup_by_name(name) do
    result =
      Registry.select(Shire.AgentRegistry, [
        {{:"$1", :_, :"$2"}, [{:is_integer, :"$1"}, {:==, :"$2", name}], [:"$1"]}
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
    {:ok, %{monitors: %{}, statuses: %{}, broadcast_timer: nil}, {:continue, :restart_agents}}
  end

  @impl true
  def handle_continue(:restart_agents, state) do
    agents = Agents.list_agents()

    if agents != [] do
      Logger.info("Restarting #{length(agents)} previously active agent(s)")
    end

    state =
      Enum.reduce(agents, state, fn agent, acc ->
        # Skip if already running (e.g. Coordinator restarted but agents survived)
        case lookup(agent.id) do
          {:ok, pid} ->
            ref = Process.monitor(pid)
            monitors = Map.put(acc.monitors, ref, agent.id)
            statuses = Map.put(acc.statuses, agent.id, :active)
            Logger.info("Agent #{agent.id} already running, re-monitoring")
            %{acc | monitors: monitors, statuses: statuses}

          {:error, :not_found} ->
            token = Application.get_env(:shire, :sprites_token)

            if token do
              client = Sprites.new(token)

              case DynamicSupervisor.start_child(
                     Shire.AgentSupervisor,
                     {AgentManager, agent: agent, sprites_client: client}
                   ) do
                {:ok, pid} ->
                  ref = Process.monitor(pid)
                  monitors = Map.put(acc.monitors, ref, agent.id)
                  statuses = Map.put(acc.statuses, agent.id, :starting)
                  Logger.info("Auto-started agent #{agent.id}")
                  %{acc | monitors: monitors, statuses: statuses}

                {:error, reason} ->
                  Logger.error("Failed to auto-start agent #{agent.id}: #{inspect(reason)}")
                  acc
              end
            else
              Logger.warning("No sprites token, skipping auto-start of agent #{agent.id}")
              acc
            end
        end
      end)

    state = if agents != [], do: schedule_peer_broadcast(state), else: state
    {:noreply, state}
  end

  @impl true
  def handle_call({:start_agent, agent_id, _opts}, _from, state) do
    case lookup(agent_id) do
      {:ok, _pid} ->
        # If the agent is in a failed state, restart it instead of rejecting
        case Map.get(state.statuses, agent_id) do
          :failed ->
            case AgentManager.restart(agent_id) do
              :ok ->
                Logger.info("Restarting failed agent #{agent_id}")
                {:reply, {:ok, :restarted}, state}

              {:error, reason} ->
                {:reply, {:error, reason}, state}
            end

          _ ->
            {:reply, {:error, :already_running}, state}
        end

      {:error, :not_found} ->
        token = Application.get_env(:shire, :sprites_token)

        if is_nil(token) do
          {:reply, {:error, :no_sprites_token}, state}
        else
          agent = Agents.get_agent!(agent_id)
          client = Sprites.new(token)

          case DynamicSupervisor.start_child(
                 Shire.AgentSupervisor,
                 {AgentManager, agent: agent, sprites_client: client}
               ) do
            {:ok, pid} ->
              ref = Process.monitor(pid)
              monitors = Map.put(state.monitors, ref, agent_id)
              statuses = Map.put(state.statuses, agent_id, :starting)
              Logger.info("Started agent #{agent_id} (pid: #{inspect(pid)})")
              state = schedule_peer_broadcast(%{state | monitors: monitors, statuses: statuses})
              {:reply, {:ok, pid}, state}

            {:error, reason} ->
              Logger.error("Failed to start agent #{agent_id}: #{inspect(reason)}")
              {:reply, {:error, reason}, state}
          end
        end
    end
  end

  @impl true
  def handle_call({:kill_agent, agent_id}, _from, state) do
    case lookup(agent_id) do
      {:ok, pid} ->
        # Derive sprite name from registry before terminating (avoids TOCTOU race)
        agent_name = lookup_name_by_id(agent_id)

        DynamicSupervisor.terminate_child(Shire.AgentSupervisor, pid)

        # Clean up monitor for this pid
        {ref, monitors} =
          Enum.find_value(state.monitors, {nil, state.monitors}, fn {ref, aid} ->
            if aid == agent_id, do: {ref, Map.delete(state.monitors, ref)}
          end)

        if ref, do: Process.demonitor(ref, [:flush])

        # Destroy the Sprite VM using the deterministic name
        destroy_sprite_vm(agent_name)

        case Agents.get_agent(agent_id) do
          {:ok, agent} -> Agents.delete_agent(agent)
          {:error, :not_found} -> :ok
        end

        statuses = Map.delete(state.statuses, agent_id)
        Logger.info("Killed agent #{agent_id} (VM destroyed, record deleted)")
        state = schedule_peer_broadcast(%{state | monitors: monitors, statuses: statuses})
        {:reply, :ok, state}

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_call({:restart_agent, agent_id}, _from, state) do
    case lookup(agent_id) do
      {:ok, _pid} ->
        case AgentManager.restart(agent_id) do
          :ok ->
            Logger.info("Restarting agent #{agent_id}")
            {:reply, :ok, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end

      {:error, :not_found} ->
        {:reply, {:error, :not_found}, state}
    end
  end

  @impl true
  def handle_call({:agent_status, agent_id}, _from, state) do
    {:reply, Map.get(state.statuses, agent_id, :created), state}
  end

  @impl true
  def handle_call({:agent_statuses, agent_ids}, _from, state) do
    result = Map.new(agent_ids, fn id -> {id, Map.get(state.statuses, id, :created)} end)
    {:reply, result, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    {agent_id, monitors} = Map.pop(state.monitors, ref)

    if agent_id do
      Logger.warning("Agent #{agent_id} process died: #{inspect(reason)}")

      statuses = Map.put(state.statuses, agent_id, :crashed)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agent:#{agent_id}",
        {:status, :crashed}
      )

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "agents:lobby",
        {:agent_status, agent_id, :crashed}
      )

      state = schedule_peer_broadcast(%{state | monitors: monitors, statuses: statuses})
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
  def handle_cast({:agent_status_changed, agent_id, status}, state) do
    statuses = Map.put(state.statuses, agent_id, status)

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agent:#{agent_id}",
      {:status, status}
    )

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "agents:lobby",
      {:agent_status, agent_id, status}
    )

    {:noreply, %{state | statuses: statuses}}
  end

  @impl true
  def handle_cast({:request_peers, _agent_id}, state) do
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

  defp broadcast_agent_event(name, event) do
    case lookup_by_name(name) do
      {:ok, agent_id} ->
        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "agent:#{agent_id}",
          {:agent_event, agent_id, event}
        )

      _ ->
        :ok
    end
  end

  defp lookup_name_by_id(agent_id) do
    case Registry.select(Shire.AgentRegistry, [
           {{:"$1", :_, :"$2"}, [{:==, :"$1", agent_id}], [:"$2"]}
         ]) do
      [name | _] -> name
      [] -> nil
    end
  end

  defp destroy_sprite_vm(nil), do: :ok

  defp destroy_sprite_vm(agent_name) do
    token = Application.get_env(:shire, :sprites_token)

    if token do
      slug = agent_name |> String.downcase() |> String.replace(~r/[^a-z0-9-]/, "-")
      client = Sprites.new(token)
      sprite = Sprites.sprite(client, "#{@sprite_prefix}-#{slug}")
      Sprites.destroy(sprite)
    end
  rescue
    e -> Logger.warning("Failed to destroy sprite VM for #{agent_name}: #{inspect(e)}")
  end

  defp truncate(text, max_length) when is_binary(text) do
    if String.length(text) <= max_length do
      text
    else
      truncated = String.slice(text, 0, max_length)

      case truncated |> String.split(~r/\s+/) |> Enum.drop(-1) do
        [] -> truncated
        words -> Enum.join(words, " ") <> "..."
      end
    end
  end
end
