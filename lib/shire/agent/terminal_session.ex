defmodule Shire.Agent.TerminalSession do
  @moduledoc """
  GenServer managing an interactive TTY session on a project's Sprite VM.
  Spawns `bash -i` with TTY mode and bridges stdin/stdout to PubSub.
  One terminal session per project.
  """
  use GenServer
  require Logger

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  defstruct [:project_name, :command, :command_ref, :pubsub_topic]

  # --- Public API ---

  def start_link(opts) do
    project_name = Keyword.fetch!(opts, :project_name)
    GenServer.start_link(__MODULE__, opts, name: via(project_name))
  end

  def write(project_name, data) do
    GenServer.cast(via(project_name), {:write, data})
  end

  def resize(project_name, rows, cols) do
    GenServer.cast(via(project_name), {:resize, rows, cols})
  end

  def stop(project_name) do
    GenServer.stop(via(project_name))
  end

  def find(project_name) do
    case Registry.lookup(Shire.ProjectRegistry, {:terminal, project_name}) do
      [{pid, _}] -> {:ok, pid}
      [] -> :error
    end
  end

  defp via(project_name) do
    {:via, Registry, {Shire.ProjectRegistry, {:terminal, project_name}}}
  end

  # --- Callbacks ---

  @impl true
  def init(opts) do
    project_name = Keyword.fetch!(opts, :project_name)

    state = %__MODULE__{
      project_name: project_name,
      pubsub_topic: "project:#{project_name}:terminal"
    }

    case @vm.spawn_command(project_name, "bash", ["-i"],
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
    Logger.info("Terminal session exited with code #{code} (project: #{state.project_name})")
    broadcast(state, {:terminal_exit, code})
    {:stop, :normal, state}
  end

  @impl true
  def handle_info({:error, %{ref: ref}, reason}, %{command_ref: ref} = state) do
    Logger.error("Terminal session error (project: #{state.project_name}): #{inspect(reason)}")
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
