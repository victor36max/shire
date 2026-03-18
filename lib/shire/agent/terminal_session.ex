defmodule Shire.Agent.TerminalSession do
  @moduledoc """
  GenServer managing an interactive TTY session on the shared Sprite VM.
  Spawns `bash -i` with TTY mode and bridges stdin/stdout to PubSub.
  Single global session (not per-agent).
  """
  use GenServer
  require Logger

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  defstruct [:command, :command_ref, pubsub_topic: "terminal:global"]

  # --- Public API ---

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: via())
  end

  def write(data) do
    GenServer.cast(via(), {:write, data})
  end

  def resize(rows, cols) do
    GenServer.cast(via(), {:resize, rows, cols})
  end

  def stop do
    GenServer.stop(via())
  end

  def find do
    case Registry.lookup(Shire.AgentRegistry, :global_terminal) do
      [{pid, _}] -> {:ok, pid}
      [] -> :error
    end
  end

  defp via do
    {:via, Registry, {Shire.AgentRegistry, :global_terminal}}
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    state = %__MODULE__{}

    case @vm.spawn_command("bash", ["-i"],
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
    @vm.write_stdin(state.command, data)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:resize, rows, cols}, state) do
    @vm.resize(state.command, rows, cols)
    {:noreply, state}
  end

  @impl true
  def handle_info({:stdout, %{ref: ref}, data}, %{command_ref: ref} = state) do
    broadcast(state, {:terminal_output, data})
    {:noreply, state}
  end

  @impl true
  def handle_info({:exit, %{ref: ref}, code}, %{command_ref: ref} = state) do
    Logger.info("Global terminal session exited with code #{code}")
    broadcast(state, {:terminal_exit, code})
    {:stop, :normal, state}
  end

  @impl true
  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Global terminal session error: #{inspect(reason)}")
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
