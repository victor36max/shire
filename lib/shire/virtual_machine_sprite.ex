defmodule Shire.VirtualMachineSprite do
  @moduledoc """
  Per-project GenServer owning a Sprite VM lifecycle. Provides consistent
  error handling, default timeouts, and failure logging for all VM operations.

  Each project gets its own VirtualMachineSprite instance, registered dynamically
  via Shire.ProjectRegistry. The VM name is derived from the configurable prefix
  and the project name.
  """
  use GenServer
  require Logger

  @behaviour Shire.VirtualMachine

  @default_cmd_timeout 30_000
  @fs_call_timeout @default_cmd_timeout + 5_000
  @ready_retries 10
  @ready_backoff 2_000
  @max_backoff 30_000
  @ping_interval 15_000
  @keepalive_duration :timer.minutes(30)

  def start_link(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    GenServer.start_link(__MODULE__, opts, name: via(project_id))
  end

  defp via(project_id) do
    {:via, Registry, {Shire.ProjectRegistry, {:vm, project_id}}}
  end

  # --- Public API: Command Execution ---

  @impl Shire.VirtualMachine
  def cmd(project_id, command, args \\ [], opts \\ []) do
    GenServer.call(via(project_id), {:cmd, command, args, opts}, call_timeout(opts))
  end

  @impl Shire.VirtualMachine
  def cmd!(project_id, command, args \\ [], opts \\ []) do
    case cmd(project_id, command, args, opts) do
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

  @impl Shire.VirtualMachine
  def read(project_id, path) do
    GenServer.call(via(project_id), {:read, path}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def write(project_id, path, content) do
    GenServer.call(via(project_id), {:write, path, content}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def mkdir_p(project_id, path) do
    GenServer.call(via(project_id), {:mkdir_p, path}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def mkdir_p_many(project_id, paths) do
    GenServer.call(via(project_id), {:mkdir_p_many, paths}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def rm(project_id, path) do
    GenServer.call(via(project_id), {:rm, path}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def rm_rf(project_id, path) do
    GenServer.call(via(project_id), {:rm_rf, path}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def ls(project_id, path) do
    GenServer.call(via(project_id), {:ls, path}, @fs_call_timeout)
  end

  @impl Shire.VirtualMachine
  def stat(project_id, path) do
    GenServer.call(via(project_id), {:stat, path}, @fs_call_timeout)
  end

  # --- Public API: Keepalive ---

  @impl Shire.VirtualMachine
  def touch_keepalive(project_id) do
    GenServer.cast(via(project_id), :touch_keepalive)
    :ok
  end

  @doc false
  def ping_interval, do: @ping_interval

  # --- Public API: Interactive Process ---

  @impl Shire.VirtualMachine
  def spawn_command(project_id, command, args \\ [], opts \\ []) do
    sprite = GenServer.call(via(project_id), :get_sprite, 5_000)

    case sprite do
      nil ->
        {:error, :no_vm}

      sprite ->
        Sprites.spawn(sprite, command, args, opts)
    end
  end

  @impl Shire.VirtualMachine
  def workspace_root(_project_id), do: "/workspace"

  @impl Shire.VirtualMachine
  def write_stdin(command, data) do
    Sprites.write(command, data)
  catch
    :exit, reason ->
      Logger.warning("VM write_stdin failed: command process dead — #{inspect(reason)}")
      {:error, {:process_dead, reason}}
  end

  @impl Shire.VirtualMachine
  def resize(command, rows, cols) do
    Sprites.resize(command, rows, cols)
  catch
    :exit, reason ->
      Logger.warning("VM resize failed: command process dead — #{inspect(reason)}")
      {:error, {:process_dead, reason}}
  end

  # --- VM Management (module-level, no GenServer) ---

  @impl Shire.VirtualMachine
  def destroy_vm(project_id) do
    token = Application.get_env(:shire, :sprites_token)

    if token do
      client = Sprites.new(token)
      name = vm_name(project_id)

      case Sprites.get_sprite(client, name) do
        {:ok, _} ->
          sprite = Sprites.sprite(client, name)
          Sprites.destroy(sprite)
          :ok

        {:error, {:not_found, _}} ->
          :ok

        {:error, reason} ->
          {:error, reason}
      end
    else
      {:error, :no_token}
    end
  end

  # --- GenServer Callbacks ---

  @doc "Returns the VM status for a project by reading directly from Registry (non-blocking)."
  @impl Shire.VirtualMachine
  def vm_status(project_id) do
    case Registry.lookup(Shire.ProjectRegistry, {:vm, project_id}) do
      [{_pid, status}] -> status
      [] -> :stopped
    end
  end

  @impl GenServer
  def init(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    token = Application.get_env(:shire, :sprites_token)

    update_registry_status(project_id, :starting)

    Logger.info("VM starting (project: #{project_id})")

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{project_id}:vm",
      {:vm_starting, project_id}
    )

    if token do
      vm_name = vm_name(project_id)

      case init_vm(token, vm_name) do
        {:ok, sprite, fs} ->
          Logger.info("VM #{vm_name} ready (project: #{project_id})")

          case Shire.VirtualMachine.Setup.run(build_setup_ops(sprite, fs)) do
            :ok -> :ok
            {:error, reason} -> Logger.error("VM setup failed: #{inspect(reason)}")
          end

          update_registry_status(project_id, :running)

          Phoenix.PubSub.broadcast(
            Shire.PubSub,
            "project:#{project_id}:vm",
            {:vm_ready, project_id}
          )

          {:ok,
           %{
             sprite: sprite,
             fs: fs,
             project_id: project_id,
             ping_timer: nil,
             ping_until: nil,
             vm_status: :running
           }}

        {:error, reason} ->
          Logger.error("Failed to initialize VM #{vm_name}: #{inspect(reason)}")
          {:stop, {:init_failed, reason}}
      end
    else
      Logger.warning("No SPRITES_TOKEN configured — VM features disabled")
      update_registry_status(project_id, :running)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{project_id}:vm",
        {:vm_ready, project_id}
      )

      {:ok,
       %{
         sprite: nil,
         fs: nil,
         project_id: project_id,
         ping_timer: nil,
         ping_until: nil,
         vm_status: :running
       }}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:mkdir_p_many, _paths}, _from, %{fs: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:mkdir_p_many, paths}, _from, state) do
    results =
      paths
      |> Task.async_stream(
        fn path -> Sprites.Filesystem.mkdir_p!(state.fs, path) end,
        max_concurrency: 10,
        timeout: 15_000
      )
      |> Enum.to_list()

    result =
      case Enum.find(results, fn
             {:exit, _} -> true
             _ -> false
           end) do
        nil -> :ok
        {:exit, reason} -> {:error, {:task_exit, reason}}
      end

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
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

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call(:get_sprite, _from, state) do
    {:reply, state.sprite, extend_keepalive(state)}
  end

  @impl GenServer
  def handle_cast(:touch_keepalive, state) do
    {:noreply, extend_keepalive(state)}
  end

  @impl GenServer
  def handle_info(:ping_vm, %{sprite: nil} = state) do
    {:noreply, %{state | ping_timer: nil, ping_until: nil}}
  end

  def handle_info(:ping_vm, state) do
    now = System.monotonic_time(:millisecond)

    if state.ping_until && now < state.ping_until do
      vm_self = self()

      Task.start(fn ->
        try do
          Sprites.cmd(state.sprite, "echo", ["ping"], timeout: 5_000)
        rescue
          _ -> send(vm_self, :ping_failed)
        end
      end)

      {:noreply, schedule_ping(state)}
    else
      update_registry_status(state.project_id, :idle)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_id}:vm",
        {:vm_went_idle, state.project_id}
      )

      {:noreply, %{state | ping_timer: nil, ping_until: nil, vm_status: :idle}}
    end
  end

  @impl GenServer
  def handle_info(:ping_failed, state) do
    if state.vm_status != :unreachable do
      Logger.warning("VM ping failed for project #{state.project_id}, marking as unreachable")
      update_registry_status(state.project_id, :unreachable)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_id}:vm",
        {:vm_unreachable, state.project_id}
      )

      {:noreply, %{state | vm_status: :unreachable}}
    else
      {:noreply, state}
    end
  end

  @impl GenServer
  def terminate(reason, %{sprite: nil} = state),
    do:
      Logger.warning(
        "VirtualMachineSprite stopping (no VM, project: #{state.project_id}): #{inspect(reason)}"
      )

  def terminate(reason, state) do
    Logger.warning(
      "VirtualMachineSprite stopping (project: #{state.project_id}): #{inspect(reason)}"
    )
  end

  # --- Private: VM Initialization ---

  defp vm_name(project_id) do
    "#{Application.get_env(:shire, :sprite_vm_prefix, "shire-")}#{project_id}"
  end

  defp init_vm(token, vm_name) do
    client = Sprites.new(token)

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
    Sprites.cmd(sprite, "echo", ["ready"], timeout: @default_cmd_timeout)
    :ok
  rescue
    e ->
      if attempt < @ready_retries do
        delay = backoff_delay(attempt)

        Logger.info(
          "VM not ready (attempt #{attempt}/#{@ready_retries}), retrying in #{delay}ms..."
        )

        Process.sleep(delay)
        wait_for_ready(sprite, attempt + 1)
      else
        raise e
      end
  end

  @doc false
  def backoff_delay(attempt) do
    base = min(@ready_backoff * Integer.pow(2, attempt - 1), @max_backoff)
    jitter = trunc(base * 0.2 * (:rand.uniform() * 2 - 1))
    base + jitter
  end

  @doc false
  def build_filesystem(sprite) do
    prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
    patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
    patched_client = %{sprite.client | req: patched_req}
    patched_sprite = %{sprite | client: patched_client}
    Sprites.filesystem(patched_sprite)
  end

  defp call_timeout(opts) do
    (Keyword.get(opts, :timeout, @default_cmd_timeout) || @default_cmd_timeout) + 5_000
  end

  defp schedule_ping(state) do
    timer = Process.send_after(self(), :ping_vm, @ping_interval)
    %{state | ping_timer: timer}
  end

  defp extend_keepalive(state) do
    ping_until = System.monotonic_time(:millisecond) + @keepalive_duration
    was_idle = is_nil(state.ping_timer)
    state = %{state | ping_until: ping_until}

    if was_idle do
      update_registry_status(state.project_id, :running)

      Phoenix.PubSub.broadcast(
        Shire.PubSub,
        "project:#{state.project_id}:vm",
        {:vm_woke_up, state.project_id}
      )

      %{schedule_ping(state) | vm_status: :running}
    else
      # If recovering from unreachable, update status and notify
      if state.vm_status == :unreachable do
        update_registry_status(state.project_id, :running)

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "project:#{state.project_id}:vm",
          {:vm_woke_up, state.project_id}
        )

        %{state | vm_status: :running}
      else
        state
      end
    end
  end

  defp build_setup_ops(sprite, fs) do
    ws_root = "/workspace"

    %{
      write: fn path, content ->
        try do
          Sprites.Filesystem.write!(fs, path, content)
          :ok
        rescue
          e -> {:error, e}
        end
      end,
      mkdir_p: fn path ->
        try do
          Sprites.Filesystem.mkdir_p!(fs, path)
          :ok
        rescue
          e -> {:error, e}
        end
      end,
      cmd: fn command, args, opts ->
        timeout = Keyword.get(opts, :timeout, @default_cmd_timeout)

        try do
          case Sprites.cmd(sprite, command, args, timeout: timeout) do
            {output, 0} -> {:ok, output}
            {output, code} -> {:error, {:exit, code, output}}
          end
        rescue
          e -> {:error, e}
        end
      end,
      runner_dir: Path.join(ws_root, ".runner"),
      workspace_root: ws_root
    }
  end

  defp update_registry_status(project_id, status) do
    Registry.update_value(Shire.ProjectRegistry, {:vm, project_id}, fn _ -> status end)
  end
end
