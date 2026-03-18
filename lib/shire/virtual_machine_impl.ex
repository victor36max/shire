defmodule Shire.VirtualMachineImpl do
  @moduledoc """
  GenServer owning the shared Sprite VM lifecycle. Provides consistent
  error handling, default timeouts, and failure logging for all VM operations.

  Callers use `vm().cmd/3`, `vm().write/2`, etc. via the Shire.VirtualMachine
  behaviour — this module is the production implementation.

  Init is synchronous — the supervisor blocks until the VM is ready, so
  downstream processes (Coordinator, AgentManager) are guaranteed a live VM.

  Wrapped in a dedicated supervisor with generous restart tolerance so
  transient network failures at boot don't permanently disable the VM.
  """
  use GenServer
  require Logger

  @behaviour Shire.VirtualMachine

  @default_cmd_timeout 30_000
  @ready_retries 6
  @ready_backoff 5_000
  @ping_interval 2_000
  @keepalive_duration :timer.minutes(30)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # --- Public API: Command Execution ---

  @doc """
  Executes a command on the VM. Returns `{:ok, output}` or `{:error, reason}`.
  Default timeout is #{@default_cmd_timeout}ms. Override with `timeout:` in opts.
  """
  @impl Shire.VirtualMachine
  def cmd(command, args \\ [], opts \\ []) do
    GenServer.call(__MODULE__, {:cmd, command, args, opts}, call_timeout(opts))
  end

  @doc "Like `cmd/3` but raises on failure."
  @impl Shire.VirtualMachine
  def cmd!(command, args \\ [], opts \\ []) do
    case cmd(command, args, opts) do
      {:ok, output} ->
        output

      {:error, {:exit, code, output}} ->
        raise "VM command failed (exit #{code}): #{command} #{Enum.join(args, " ")}\n#{output}"

      {:error, e} when is_exception(e) ->
        raise e

      {:error, reason} ->
        raise "VM command failed: #{command} #{Enum.join(args, " ")} — #{inspect(reason)}"
    end
  end

  # --- Public API: Filesystem ---

  @doc "Reads a file from the VM filesystem."
  @impl Shire.VirtualMachine
  def read(path) do
    GenServer.call(__MODULE__, {:read, path})
  end

  @doc "Writes content to a file on the VM filesystem."
  @impl Shire.VirtualMachine
  def write(path, content) do
    GenServer.call(__MODULE__, {:write, path, content})
  end

  @doc "Creates a directory (and parents) on the VM filesystem."
  @impl Shire.VirtualMachine
  def mkdir_p(path) do
    GenServer.call(__MODULE__, {:mkdir_p, path})
  end

  @doc "Removes a file from the VM filesystem."
  @impl Shire.VirtualMachine
  def rm(path) do
    GenServer.call(__MODULE__, {:rm, path})
  end

  @doc "Recursively removes a file or directory from the VM filesystem."
  @impl Shire.VirtualMachine
  def rm_rf(path) do
    GenServer.call(__MODULE__, {:rm_rf, path})
  end

  @doc "Lists directory contents on the VM filesystem."
  @impl Shire.VirtualMachine
  def ls(path) do
    GenServer.call(__MODULE__, {:ls, path})
  end

  @doc "Gets file/directory stats from the VM filesystem."
  @impl Shire.VirtualMachine
  def stat(path) do
    GenServer.call(__MODULE__, {:stat, path})
  end

  # --- Public API: Interactive Process ---

  @doc """
  Spawns an async command on the VM (for interactive/streaming use).

  The spawn is executed in the **caller's** process so that stdout/stderr/exit
  messages are delivered directly to the caller (e.g. AgentManager, TerminalSession)
  rather than to this GenServer.
  """
  @impl Shire.VirtualMachine
  def spawn_command(command, args \\ [], opts \\ []) do
    sprite = GenServer.call(__MODULE__, :get_sprite)

    case sprite do
      nil ->
        {:error, :no_vm}

      sprite ->
        Sprites.spawn(sprite, command, args, opts)
    end
  end

  @doc "Writes data to a command's stdin. Returns `:ok` or `{:error, reason}` if the process is dead."
  @impl Shire.VirtualMachine
  @spec write_stdin(Sprites.Command.t(), binary()) :: :ok | {:error, term()}
  def write_stdin(command, data) do
    Sprites.write(command, data)
  catch
    :exit, reason ->
      Logger.warning("VM write_stdin failed: command process dead — #{inspect(reason)}")
      {:error, {:process_dead, reason}}
  end

  @doc "Resizes a command's TTY. Returns `:ok` or `{:error, reason}` if the process is dead."
  @impl Shire.VirtualMachine
  @spec resize(Sprites.Command.t(), integer(), integer()) :: :ok | {:error, term()}
  def resize(command, rows, cols) do
    Sprites.resize(command, rows, cols)
  catch
    :exit, reason ->
      Logger.warning("VM resize failed: command process dead — #{inspect(reason)}")
      {:error, {:process_dead, reason}}
  end

  # --- GenServer Callbacks ---

  @impl GenServer
  def init(_opts) do
    token = Application.get_env(:shire, :sprites_token)

    if token do
      case init_shared_vm(token) do
        {:ok, sprite, fs} ->
          Logger.info("Shared VM #{get_sprite_name()} ready")
          {:ok, %{sprite: sprite, fs: fs, ping_timer: nil, ping_until: nil}}

        {:error, reason} ->
          Logger.error("Failed to initialize shared VM: #{inspect(reason)}")
          {:stop, {:init_failed, reason}}
      end
    else
      Logger.warning("No SPRITES_TOKEN configured — VM features disabled")
      {:ok, %{sprite: nil, fs: nil, ping_timer: nil, ping_until: nil}}
    end
  end

  @impl GenServer
  def handle_call({:cmd, _command, _args, _opts}, _from, %{sprite: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:cmd, command, args, opts}, _from, state) do
    opts = Keyword.put_new(opts, :timeout, @default_cmd_timeout)

    result =
      try do
        case Sprites.cmd(state.sprite, command, args, opts) do
          {output, 0} ->
            {:ok, output}

          {output, code} ->
            Logger.error("VM cmd failed: #{command} #{Enum.join(args, " ")} (exit #{code})")
            {:error, {:exit, code, output}}
        end
      rescue
        e ->
          Logger.error(
            "VM cmd exception: #{command} #{Enum.join(args, " ")} — #{Exception.message(e)}"
          )

          {:error, e}
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:read, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:read, path}, _from, state) do
    result =
      case Sprites.Filesystem.read(state.fs, path) do
        {:ok, _} = ok ->
          ok

        {:error, reason} = err ->
          Logger.error("VM read failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:write, _path, _content}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:write, path, content}, _from, state) do
    result =
      try do
        Sprites.Filesystem.write!(state.fs, path, content)
        :ok
      rescue
        e ->
          Logger.error("VM write failed: #{path} — #{Exception.message(e)}")
          {:error, e}
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:mkdir_p, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:mkdir_p, path}, _from, state) do
    result =
      try do
        Sprites.Filesystem.mkdir_p!(state.fs, path)
        :ok
      rescue
        e ->
          Logger.error("VM mkdir_p failed: #{path} — #{Exception.message(e)}")
          {:error, e}
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:rm, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:rm, path}, _from, state) do
    result =
      try do
        Sprites.Filesystem.rm!(state.fs, path)
        :ok
      rescue
        e ->
          Logger.error("VM rm failed: #{path} — #{Exception.message(e)}")
          {:error, e}
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:rm_rf, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:rm_rf, path}, _from, state) do
    result =
      try do
        Sprites.Filesystem.rm_rf!(state.fs, path)
        :ok
      rescue
        e ->
          Logger.error("VM rm_rf failed: #{path} — #{Exception.message(e)}")
          {:error, e}
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:ls, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:ls, path}, _from, state) do
    result =
      case Sprites.Filesystem.ls(state.fs, path) do
        {:ok, _} = ok ->
          ok

        {:error, reason} = err ->
          Logger.error("VM ls failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call({:stat, _path}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:stat, path}, _from, state) do
    result =
      case Sprites.Filesystem.stat(state.fs, path) do
        {:ok, _} = ok ->
          ok

        {:error, reason} = err ->
          Logger.error("VM stat failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, touch_keepalive(state)}
  end

  def handle_call(:get_sprite, _from, state) do
    {:reply, state.sprite, touch_keepalive(state)}
  end

  @impl GenServer
  def handle_info(:ping_vm, %{sprite: nil} = state) do
    {:noreply, %{state | ping_timer: nil, ping_until: nil}}
  end

  def handle_info(:ping_vm, state) do
    now = System.monotonic_time(:millisecond)

    if state.ping_until && now < state.ping_until do
      Task.start(fn ->
        try do
          Sprites.cmd(state.sprite, "echo", ["ping"], timeout: 5_000)
        rescue
          _ -> :ok
        end
      end)

      {:noreply, schedule_ping(state)}
    else
      {:noreply, %{state | ping_timer: nil, ping_until: nil}}
    end
  end

  @impl GenServer
  def terminate(reason, %{sprite: nil}),
    do: Logger.warning("VirtualMachineImpl stopping (no VM): #{inspect(reason)}")

  def terminate(reason, _state) do
    Logger.warning("VirtualMachineImpl stopping: #{inspect(reason)}")
  end

  # --- Private: VM Initialization ---

  defp get_sprite_name() do
    Application.get_env(:shire, :sprite_vm_name, "shire-vm")
  end

  defp init_shared_vm(token) do
    client = Sprites.new(token)
    vm_name = get_sprite_name()

    sprite =
      case Sprites.get_sprite(client, vm_name) do
        {:ok, _info} ->
          Sprites.sprite(client, vm_name)

        {:error, {:not_found, _}} ->
          {:ok, s} = Sprites.create(client, vm_name)
          s

        {:error, reason} ->
          raise "Failed to get or create VM #{vm_name}: #{inspect(reason)}"
      end

    wait_for_ready(sprite)

    fs = build_filesystem(sprite)
    {:ok, sprite, fs}
  rescue
    e -> {:error, e}
  end

  defp wait_for_ready(sprite, attempt \\ 1) do
    Sprites.cmd(sprite, "echo", ["ready"], timeout: 10_000)
    :ok
  rescue
    e ->
      if attempt < @ready_retries do
        Logger.info(
          "VM not ready (attempt #{attempt}/#{@ready_retries}), retrying in #{@ready_backoff}ms..."
        )

        Process.sleep(@ready_backoff)
        wait_for_ready(sprite, attempt + 1)
      else
        raise e
      end
  end

  @doc false
  def build_filesystem(sprite) do
    prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
    patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
    patched_client = %{sprite.client | req: patched_req}
    patched_sprite = %{sprite | client: patched_client}
    Sprites.filesystem(patched_sprite)
  end

  # GenServer call timeout: use the command timeout + 5s buffer
  defp call_timeout(opts) do
    (Keyword.get(opts, :timeout, @default_cmd_timeout) || @default_cmd_timeout) + 5_000
  end

  defp schedule_ping(state) do
    timer = Process.send_after(self(), :ping_vm, @ping_interval)
    %{state | ping_timer: timer}
  end

  defp touch_keepalive(state) do
    ping_until = System.monotonic_time(:millisecond) + @keepalive_duration
    state = %{state | ping_until: ping_until}

    if state.ping_timer do
      state
    else
      schedule_ping(state)
    end
  end
end
