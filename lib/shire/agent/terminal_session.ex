defmodule Shire.Agent.TerminalSession do
  @moduledoc """
  GenServer managing an interactive TTY session on a Sprite VM.
  Spawns `bash -i` with TTY mode and bridges stdin/stdout to PubSub.
  """
  use GenServer
  require Logger

  defstruct [:agent_id, :sprite, :command, :command_ref, :pubsub_topic]

  # --- Public API ---

  def start_link(opts) do
    agent_id = Keyword.fetch!(opts, :agent_id)
    GenServer.start_link(__MODULE__, opts, name: via(agent_id))
  end

  def write(pid, data) do
    GenServer.cast(pid, {:write, data})
  end

  def resize(pid, rows, cols) do
    GenServer.cast(pid, {:resize, rows, cols})
  end

  def stop(pid) do
    GenServer.stop(pid)
  end

  def find(agent_id) do
    case Registry.lookup(Shire.AgentRegistry, {:terminal, agent_id}) do
      [{pid, _}] -> {:ok, pid}
      [] -> :error
    end
  end

  defp via(agent_id) do
    {:via, Registry, {Shire.AgentRegistry, {:terminal, agent_id}}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    agent_id = Keyword.fetch!(opts, :agent_id)
    sprite = Keyword.fetch!(opts, :sprite)

    state = %__MODULE__{
      agent_id: agent_id,
      sprite: sprite,
      pubsub_topic: "terminal:#{agent_id}"
    }

    case Sprites.spawn(sprite, "bash", ["-i"],
           tty: true,
           stdin: true,
           tty_rows: 24,
           tty_cols: 80
         ) do
      {:ok, command} ->
        {:ok, %{state | command: command, command_ref: command.ref}}

      {:error, reason} ->
        {:stop, reason}
    end
  end

  @impl true
  def handle_cast({:write, data}, state) do
    try do
      Sprites.write(state.command, data)
    catch
      :exit, _ ->
        Logger.warning("Terminal write failed for agent #{state.agent_id}: command process dead")
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast({:resize, rows, cols}, state) do
    try do
      Sprites.resize(state.command, rows, cols)
    catch
      :exit, _ -> :ok
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    broadcast(state, {:terminal_output, data})
    {:noreply, state}
  end

  @impl true
  def handle_info({:exit, %{ref: ref}, code}, %{command_ref: ref} = state) do
    Logger.info("Terminal session for agent #{state.agent_id} exited with code #{code}")
    broadcast(state, {:terminal_exit, code})
    {:stop, :normal, state}
  end

  @impl true
  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Terminal session error for agent #{state.agent_id}: #{inspect(reason)}")
    broadcast(state, {:terminal_exit, 1})
    {:stop, :normal, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end

  defp broadcast(state, message) do
    Phoenix.PubSub.broadcast(Shire.PubSub, state.pubsub_topic, message)
  end
end
