defmodule Shire.VirtualMachineE2B do
  @moduledoc """
  E2B sandbox implementation of the VirtualMachine behaviour.

  Each project gets its own E2B sandbox, managed as a GenServer registered
  via Shire.ProjectRegistry. Sandboxes are discovered by project_id metadata
  on init, or created fresh if none exists.

  Requires `E2B_API_KEY` environment variable. Optionally configure
  `E2B_TEMPLATE_ID` for a custom sandbox template.
  """
  use GenServer
  require Logger

  @behaviour Shire.VirtualMachine

  alias Shire.VirtualMachineE2B.Client
  alias Shire.VirtualMachineE2B.StreamHandler

  @default_cmd_timeout 30_000
  @ping_interval 2_000
  @keepalive_duration :timer.minutes(30)
  @sandbox_timeout 3600
  @workspace_root "/home/user"

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
    GenServer.call(via(project_id), {:read, path})
  end

  @impl Shire.VirtualMachine
  def write(project_id, path, content) do
    GenServer.call(via(project_id), {:write, path, content})
  end

  @impl Shire.VirtualMachine
  def mkdir_p(project_id, path) do
    GenServer.call(via(project_id), {:mkdir_p, path})
  end

  @impl Shire.VirtualMachine
  def rm(project_id, path) do
    GenServer.call(via(project_id), {:rm, path})
  end

  @impl Shire.VirtualMachine
  def rm_rf(project_id, path) do
    GenServer.call(via(project_id), {:rm_rf, path})
  end

  @impl Shire.VirtualMachine
  def ls(project_id, path) do
    GenServer.call(via(project_id), {:ls, path})
  end

  @impl Shire.VirtualMachine
  def stat(project_id, path) do
    GenServer.call(via(project_id), {:stat, path})
  end

  # --- Public API: Keepalive ---

  @impl Shire.VirtualMachine
  def touch_keepalive(project_id) do
    GenServer.cast(via(project_id), :touch_keepalive)
    :ok
  end

  # --- Public API: Interactive Process ---

  @impl Shire.VirtualMachine
  def spawn_command(project_id, command, args \\ [], opts \\ []) do
    GenServer.call(via(project_id), {:spawn_command, command, args, opts}, call_timeout(opts))
  end

  @impl Shire.VirtualMachine
  def workspace_root(_project_id), do: @workspace_root

  @impl Shire.VirtualMachine
  def write_stdin(%{pid: pid}, data) do
    if Process.alive?(pid) do
      send(pid, {:write, data})
      :ok
    else
      {:error, {:process_dead, :noproc}}
    end
  end

  @impl Shire.VirtualMachine
  def resize(%{pid: pid}, rows, cols) do
    if Process.alive?(pid) do
      send(pid, {:resize, rows, cols})
      :ok
    else
      :ok
    end
  end

  def resize(_command, _rows, _cols), do: :ok

  # --- VM Management ---

  @impl Shire.VirtualMachine
  def destroy_vm(project_id) do
    api_key = Application.get_env(:shire, :e2b_api_key)

    if api_key do
      case Client.find_sandbox_by_metadata(api_key, "project_id", project_id) do
        {:ok, %{"sandboxID" => sandbox_id}} ->
          Client.delete_sandbox(api_key, sandbox_id)

        {:ok, nil} ->
          :ok

        {:error, reason} ->
          {:error, reason}
      end
    else
      {:error, :no_api_key}
    end
  end

  @impl Shire.VirtualMachine
  def vm_status(project_id) do
    case Registry.lookup(Shire.ProjectRegistry, {:vm, project_id}) do
      [{_pid, status}] -> status
      [] -> :stopped
    end
  end

  # --- GenServer Callbacks ---

  @impl GenServer
  def init(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    api_key = Application.get_env(:shire, :e2b_api_key)
    template_id = Application.get_env(:shire, :e2b_template_id, "base")

    update_registry_status(project_id, :starting)

    if api_key do
      case init_sandbox(api_key, template_id, project_id) do
        {:ok, sandbox_id, access_token} ->
          Logger.info("E2B sandbox #{sandbox_id} ready (project: #{project_id})")
          update_registry_status(project_id, :running)

          {:ok,
           %{
             project_id: project_id,
             sandbox_id: sandbox_id,
             access_token: access_token,
             api_key: api_key,
             template_id: template_id,
             ping_timer: nil,
             ping_until: nil,
             vm_status: :running
           }}

        {:error, reason} ->
          Logger.error(
            "Failed to initialize E2B sandbox for project #{project_id}: #{inspect(reason)}"
          )

          {:stop, {:init_failed, reason}}
      end
    else
      Logger.warning("No E2B_API_KEY configured — VM features disabled")
      update_registry_status(project_id, :running)

      {:ok,
       %{
         project_id: project_id,
         sandbox_id: nil,
         access_token: nil,
         api_key: nil,
         template_id: template_id,
         ping_timer: nil,
         ping_until: nil,
         vm_status: :running
       }}
    end
  end

  @impl GenServer
  def handle_call({:cmd, _command, _args, _opts}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:cmd, command, args, opts}, _from, state) do
    timeout = Keyword.get(opts, :timeout, @default_cmd_timeout)
    cwd = Keyword.get(opts, :dir, @workspace_root)
    env = build_env(Keyword.get(opts, :env))

    result =
      try do
        run_cmd_sync(state.sandbox_id, state.access_token, command, args, cwd, env, timeout)
      rescue
        e ->
          Logger.error(
            "E2B cmd exception: #{command} #{Enum.join(args, " ")} — #{Exception.message(e)}"
          )

          {:error, e}
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:read, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:read, path}, _from, state) do
    result =
      case Client.read_file(state.sandbox_id, state.access_token, path) do
        {:ok, _} = ok ->
          ok

        {:error, reason} = err ->
          Logger.error("E2B read failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:write, _path, _content}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:write, path, content}, _from, state) do
    result =
      case Client.write_file(state.sandbox_id, state.access_token, path, content) do
        :ok ->
          :ok

        {:error, reason} = err ->
          Logger.error("E2B write failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:mkdir_p, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:mkdir_p, path}, _from, state) do
    result =
      case Client.mkdir_p(state.sandbox_id, state.access_token, path) do
        :ok ->
          :ok

        {:error, reason} = err ->
          Logger.error("E2B mkdir_p failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:rm, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:rm, path}, _from, state) do
    result =
      case Client.remove(state.sandbox_id, state.access_token, path) do
        :ok ->
          :ok

        {:error, reason} = err ->
          Logger.error("E2B rm failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:rm_rf, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:rm_rf, path}, _from, state) do
    result =
      try do
        run_cmd_sync(state.sandbox_id, state.access_token, "rm", ["-rf", path], "/", %{}, 30_000)
        |> case do
          {:ok, _} -> :ok
          {:error, {:exit, _code, _output}} = err -> err
          {:error, _} = err -> err
        end
      rescue
        e ->
          Logger.error("E2B rm_rf failed: #{path} — #{Exception.message(e)}")
          {:error, e}
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:ls, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:ls, path}, _from, state) do
    result =
      case Client.list_dir(state.sandbox_id, state.access_token, path) do
        {:ok, entries} ->
          normalized =
            Enum.map(entries, fn entry ->
              %{
                "name" => entry["name"],
                "isDir" => entry["type"] == "FILE_TYPE_DIRECTORY",
                "size" => entry["size"] || 0
              }
            end)

          {:ok, normalized}

        {:error, reason} = err ->
          Logger.error("E2B ls failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:stat, _path}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:stat, path}, _from, state) do
    result =
      case Client.stat_path(state.sandbox_id, state.access_token, path) do
        {:ok, entry} ->
          type_str =
            if entry["type"] == "FILE_TYPE_DIRECTORY", do: "directory", else: "file"

          {:ok, %{"type" => type_str, "size" => entry["size"] || 0}}

        {:error, reason} = err ->
          Logger.error("E2B stat failed: #{path} — #{inspect(reason)}")
          err
      end

    {:reply, result, extend_keepalive(state)}
  end

  def handle_call({:spawn_command, _cmd, _args, _opts}, _from, %{sandbox_id: nil} = state) do
    {:reply, {:error, :no_vm}, state}
  end

  def handle_call({:spawn_command, command, args, opts}, _from, state) do
    result =
      StreamHandler.start_link(state.sandbox_id, state.access_token, command, args, opts)

    {:reply, result, extend_keepalive(state)}
  end

  @impl GenServer
  def handle_cast(:touch_keepalive, state) do
    {:noreply, extend_keepalive(state)}
  end

  @impl GenServer
  def handle_info(:ping_vm, %{sandbox_id: nil} = state) do
    {:noreply, %{state | ping_timer: nil, ping_until: nil}}
  end

  def handle_info(:ping_vm, state) do
    now = System.monotonic_time(:millisecond)

    if state.ping_until && now < state.ping_until do
      vm_self = self()

      Task.start(fn ->
        case Client.refresh_sandbox(state.api_key, state.sandbox_id) do
          :ok -> :ok
          {:error, _} -> send(vm_self, :ping_failed)
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

  def handle_info(:ping_failed, state) do
    if state.vm_status != :unreachable do
      Logger.warning(
        "E2B sandbox ping failed for project #{state.project_id}, marking as unreachable"
      )

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
  def terminate(reason, %{sandbox_id: nil} = state) do
    Logger.warning(
      "VirtualMachineE2B stopping (no sandbox, project: #{state.project_id}): #{inspect(reason)}"
    )
  end

  def terminate(reason, state) do
    Logger.warning(
      "VirtualMachineE2B stopping (project: #{state.project_id}, sandbox: #{state.sandbox_id}): #{inspect(reason)}"
    )
  end

  # --- Private: Sandbox Initialization ---

  defp init_sandbox(api_key, template_id, project_id) do
    case Client.find_sandbox_by_metadata(api_key, "project_id", project_id) do
      {:ok, %{"sandboxID" => sandbox_id, "envdAccessToken" => access_token}}
      when is_binary(sandbox_id) ->
        Logger.info(
          "Reconnecting to existing E2B sandbox #{sandbox_id} for project #{project_id}"
        )

        case Client.refresh_sandbox(api_key, sandbox_id) do
          :ok ->
            {:ok, sandbox_id, access_token}

          {:error, reason} ->
            Logger.warning(
              "Failed to refresh sandbox #{sandbox_id}: #{inspect(reason)}, creating new"
            )

            create_new_sandbox(api_key, template_id, project_id)
        end

      {:ok, _} ->
        create_new_sandbox(api_key, template_id, project_id)

      {:error, reason} ->
        Logger.warning("Failed to list sandboxes, creating new: #{inspect(reason)}")
        create_new_sandbox(api_key, template_id, project_id)
    end
  end

  defp create_new_sandbox(api_key, template_id, project_id) do
    metadata = %{"project_id" => project_id}

    case Client.create_sandbox(api_key, template_id, metadata, @sandbox_timeout) do
      {:ok, %{sandbox_id: sandbox_id, access_token: access_token}} ->
        Logger.info("Created E2B sandbox #{sandbox_id} for project #{project_id}")
        {:ok, sandbox_id, access_token}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # --- Private: Synchronous Command Execution ---

  defp run_cmd_sync(sandbox_id, access_token, cmd, args, cwd, env, timeout) do
    opts = [
      cwd: cwd,
      envs: env,
      caller: self(),
      stdin: false,
      tty: false
    ]

    {:ok, %{ref: stream_ref, pid: handler_pid}} =
      StreamHandler.start_link(sandbox_id, access_token, cmd, args, opts)

    collect_cmd_output(stream_ref, handler_pid, "", timeout)
  end

  defp collect_cmd_output(ref, handler_pid, acc, timeout) do
    receive do
      {:stdout, %{ref: ^ref}, data} ->
        collect_cmd_output(ref, handler_pid, acc <> data, timeout)

      {:exit, %{ref: ^ref}, 0} ->
        {:ok, acc}

      {:exit, %{ref: ^ref}, code} ->
        {:error, {:exit, code, acc}}
    after
      timeout ->
        Process.exit(handler_pid, :kill)
        flush_ref(ref)
        {:error, :timeout}
    end
  end

  defp flush_ref(ref) do
    receive do
      {:stdout, %{ref: ^ref}, _} -> flush_ref(ref)
      {:exit, %{ref: ^ref}, _} -> flush_ref(ref)
    after
      0 -> :ok
    end
  end

  # --- Private: Helpers ---

  defp build_env(nil), do: %{}
  defp build_env(env) when is_map(env), do: env

  defp build_env(env) when is_list(env) do
    Map.new(env, fn {k, v} -> {to_string(k), to_string(v)} end)
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
      # Only broadcast wake-up when transitioning from idle (not on first call after init)
      if state.vm_status == :idle do
        update_registry_status(state.project_id, :running)

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "project:#{state.project_id}:vm",
          {:vm_woke_up, state.project_id}
        )
      end

      %{schedule_ping(state) | vm_status: :running}
    else
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

  defp update_registry_status(project_id, status) do
    Registry.update_value(Shire.ProjectRegistry, {:vm, project_id}, fn _ -> status end)
  end
end
