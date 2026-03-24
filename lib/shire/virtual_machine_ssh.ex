defmodule Shire.VirtualMachineSSH do
  @moduledoc """
  SSH-based implementation of the VirtualMachine behaviour.
  Connects to any VPS via SSH for command execution and SFTP for filesystem operations.

  Workspace root: configurable via `SHIRE_SSH_WORKSPACE_ROOT` env var,
  defaults to `/home/{user}/shire/projects`.
  """
  use GenServer
  require Logger
  require Record

  @behaviour Shire.VirtualMachine

  Record.defrecordp(
    :file_info,
    :file_info,
    Record.extract(:file_info, from_lib: "kernel/include/file.hrl")
  )

  @default_cmd_timeout 30_000
  @connect_timeout 10_000
  @forward_loop_idle_timeout :timer.minutes(10)

  # --- start_link / child_spec ---

  def start_link(opts) do
    project_id = Keyword.fetch!(opts, :project_id)
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  defp via(project_id) do
    {:via, Registry, {Shire.ProjectRegistry, {:vm, project_id}}}
  end

  # --- Workspace Root ---

  @impl Shire.VirtualMachine
  def workspace_root(project_id) do
    Path.join(ssh_config(:workspace_root), project_id)
  end

  # --- Command Execution ---

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
        raise "SSH command failed (exit #{code}): #{command} #{Enum.join(args, " ")}\n#{output}"

      {:error, reason} ->
        raise "SSH command failed: #{command} #{Enum.join(args, " ")} — #{inspect(reason)}"
    end
  end

  # --- Filesystem ---

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

  # --- Interactive Process ---

  @impl Shire.VirtualMachine
  def spawn_command(project_id, command, args \\ [], opts \\ []) do
    conn = GenServer.call(via(project_id), :get_conn)

    if is_nil(conn) do
      {:error, :no_connection}
    else
      spawn_ssh_command(conn, project_id, command, args, opts)
    end
  end

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
      {:error, {:process_dead, :noproc}}
    end
  end

  # --- Status & Lifecycle ---

  @impl Shire.VirtualMachine
  def touch_keepalive(_project_id), do: :ok

  @impl Shire.VirtualMachine
  def vm_status(project_id) do
    case Registry.lookup(Shire.ProjectRegistry, {:vm, project_id}) do
      [{_pid, status}] -> status
      [] -> :stopped
    end
  end

  @impl Shire.VirtualMachine
  def destroy_vm(project_id) do
    root = workspace_root(project_id)

    case cmd(project_id, "rm", ["-rf", root]) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- GenServer Callbacks ---

  @impl GenServer
  def init(project_id) do
    root = workspace_root(project_id)
    update_registry_status(project_id, :starting)

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{project_id}:vm",
      {:vm_starting, project_id}
    )

    config = Application.get_env(:shire, :ssh)

    case connect(config) do
      {:ok, conn, sftp} ->
        sftp_mkdir_p(sftp, root)

        case Shire.VirtualMachine.Setup.run(build_setup_ops(conn, sftp, root)) do
          :ok -> :ok
          {:error, reason} -> Logger.error("SSH VM setup failed: #{inspect(reason)}")
        end

        Logger.info("SSH VM ready for project #{project_id} at #{config[:host]}:#{root}")
        update_registry_status(project_id, :running)

        Phoenix.PubSub.broadcast(
          Shire.PubSub,
          "project:#{project_id}:vm",
          {:vm_ready, project_id}
        )

        {:ok,
         %{
           project_id: project_id,
           conn: conn,
           sftp: sftp,
           workspace_root: root
         }}

      {:error, reason} ->
        Logger.error("Failed to connect SSH for project #{project_id}: #{inspect(reason)}")
        {:stop, {:ssh_connect_failed, reason}}
    end
  end

  # --- handle_call: Command Execution ---

  @impl GenServer
  def handle_call({:cmd, command, args, opts}, _from, state) do
    timeout = Keyword.get(opts, :timeout, @default_cmd_timeout)
    result = ssh_exec(state.conn, command, args, opts, state.workspace_root, timeout)
    {:reply, result, state}
  end

  # --- handle_call: Filesystem ---

  def handle_call({:read, path}, _from, state) do
    result =
      case :ssh_sftp.read_file(state.sftp, to_charlist(path)) do
        {:ok, content} -> {:ok, content}
        {:error, reason} -> {:error, reason}
      end

    {:reply, result, state}
  end

  def handle_call({:write, path, content}, _from, state) do
    sftp_mkdir_p(state.sftp, Path.dirname(path))

    result =
      case :ssh_sftp.write_file(state.sftp, to_charlist(path), content) do
        :ok -> :ok
        {:error, reason} -> {:error, reason}
      end

    {:reply, result, state}
  end

  def handle_call({:mkdir_p, path}, _from, state) do
    result = sftp_mkdir_p(state.sftp, path)
    {:reply, result, state}
  end

  def handle_call({:rm, path}, _from, state) do
    result =
      case :ssh_sftp.delete(state.sftp, to_charlist(path)) do
        :ok -> :ok
        {:error, reason} -> {:error, reason}
      end

    {:reply, result, state}
  end

  def handle_call({:rm_rf, _path}, _from, %{conn: nil} = state) do
    {:reply, {:error, :no_connection}, state}
  end

  def handle_call({:rm_rf, path}, _from, state) do
    result =
      ssh_exec(state.conn, "rm", ["-rf", path], [], state.workspace_root, @default_cmd_timeout)

    result =
      case result do
        {:ok, _} -> :ok
        error -> error
      end

    {:reply, result, state}
  end

  def handle_call({:ls, path}, _from, state) do
    result =
      case :ssh_sftp.list_dir(state.sftp, to_charlist(path)) do
        {:ok, entries} ->
          items =
            entries
            |> Enum.reject(fn name -> name in [~c".", ~c".."] end)
            |> Enum.map(fn name ->
              name_str = to_string(name)
              full_path = Path.join(path, name_str)

              case :ssh_sftp.read_file_info(state.sftp, to_charlist(full_path)) do
                {:ok, fi} ->
                  %{
                    "name" => name_str,
                    "isDir" => file_info(fi, :type) == :directory,
                    "size" => file_info(fi, :size) || 0
                  }

                {:error, _} ->
                  %{"name" => name_str, "isDir" => false, "size" => 0}
              end
            end)

          {:ok, items}

        {:error, reason} ->
          {:error, reason}
      end

    {:reply, result, state}
  end

  def handle_call({:stat, path}, _from, state) do
    result =
      case :ssh_sftp.read_file_info(state.sftp, to_charlist(path)) do
        {:ok, fi} ->
          type_str = if file_info(fi, :type) == :directory, do: "directory", else: "file"
          {:ok, %{"type" => type_str, "size" => file_info(fi, :size) || 0}}

        {:error, reason} ->
          {:error, reason}
      end

    {:reply, result, state}
  end

  def handle_call(:get_conn, _from, state) do
    {:reply, state.conn, state}
  end

  @impl GenServer
  def terminate(reason, state) do
    Logger.warning(
      "VirtualMachineSSH stopping (project: #{state.project_id}): #{inspect(reason)}"
    )

    if state[:sftp], do: :ssh_sftp.stop_channel(state.sftp)
    if state[:conn], do: :ssh.close(state.conn)
  end

  # --- Private: SSH Connection ---

  defp connect(config) do
    host = to_charlist(config[:host])
    port = config[:port]
    user = to_charlist(config[:user])

    auth_opts = auth_opts(config)

    ssh_opts =
      [
        {:user, user},
        {:silently_accept_hosts, true},
        {:connect_timeout, @connect_timeout},
        {:user_interaction, false}
      ] ++ auth_opts

    case :ssh.connect(host, port, ssh_opts) do
      {:ok, conn} ->
        case :ssh_sftp.start_channel(conn) do
          {:ok, sftp} -> {:ok, conn, sftp}
          {:error, reason} -> {:error, {:sftp_channel, reason}}
        end

      {:error, reason} ->
        {:error, {:ssh_connect, reason}}
    end
  end

  defp auth_opts(config) do
    case {config[:key], config[:password]} do
      {key, _} when is_binary(key) and key != "" ->
        normalized_key = String.replace(key, "\\n", "\n")
        [{:key_cb, {Shire.VirtualMachineSSH.KeyCb, key_pem: normalized_key}}]

      {_, password} when is_binary(password) and password != "" ->
        [{:password, to_charlist(password)}]

      _ ->
        raise "SSH auth requires either SHIRE_SSH_KEY (raw PEM) or SHIRE_SSH_PASSWORD"
    end
  end

  # --- Private: Command Execution ---

  defp ssh_exec(conn, command, args, opts, workspace_root, timeout) do
    env_prefix = build_env_prefix(Keyword.get(opts, :env))
    dir = Keyword.get(opts, :dir, workspace_root)
    cmd_str = build_command_string(command, args)
    full_cmd = "#{env_prefix}cd #{shell_escape(dir)} && #{cmd_str}"

    case :ssh_connection.session_channel(conn, timeout) do
      {:ok, channel} ->
        :ok = :ssh_connection.exec(conn, channel, to_charlist(full_cmd), timeout)
        collect_exec_output(conn, channel, timeout)

      {:error, reason} ->
        {:error, {:channel_open, reason}}
    end
  end

  defp collect_exec_output(conn, channel, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    collect_exec_output(conn, channel, deadline, _output = "", _exit_code = nil)
  end

  defp collect_exec_output(conn, channel, deadline, output, exit_code) do
    remaining = max(0, deadline - System.monotonic_time(:millisecond))

    receive do
      {:ssh_cm, ^conn, {:data, ^channel, _type, data}} ->
        collect_exec_output(conn, channel, deadline, output <> data, exit_code)

      {:ssh_cm, ^conn, {:eof, ^channel}} ->
        collect_exec_output(conn, channel, deadline, output, exit_code)

      {:ssh_cm, ^conn, {:exit_status, ^channel, code}} ->
        collect_exec_output(conn, channel, deadline, output, code)

      {:ssh_cm, ^conn, {:closed, ^channel}} ->
        code = exit_code || 0

        if code == 0 do
          {:ok, output}
        else
          {:error, {:exit, code, output}}
        end
    after
      remaining ->
        :ssh_connection.close(conn, channel)
        {:error, :timeout}
    end
  end

  # --- Private: Spawned Interactive Process ---

  defp spawn_ssh_command(conn, project_id, command, args, opts) do
    caller = self()
    ref = make_ref()
    env = Keyword.get(opts, :env)
    dir = Keyword.get(opts, :dir, workspace_root(project_id))
    tty = Keyword.get(opts, :tty, false)

    pid =
      spawn(fn ->
        case :ssh_connection.session_channel(conn, @default_cmd_timeout) do
          {:ok, channel} ->
            if tty do
              :ssh_connection.ptty_alloc(conn, channel, [
                {:term, ~c"xterm-256color"},
                {:width, 80},
                {:height, 24}
              ])
            end

            env_prefix = build_env_prefix(env)
            cmd_str = build_command_string(command, args)
            full_cmd = "#{env_prefix}cd #{shell_escape(dir)} && #{cmd_str}"

            :ok = :ssh_connection.exec(conn, channel, to_charlist(full_cmd), @default_cmd_timeout)
            forward_loop(conn, channel, caller, ref, _exit_code = nil)

          {:error, reason} ->
            send(caller, {:exit, %{ref: ref}, 1})
            Logger.error("SSH spawn_command channel open failed: #{inspect(reason)}")
        end
      end)

    {:ok, %{ref: ref, pid: pid}}
  rescue
    e -> {:error, e}
  end

  defp forward_loop(conn, channel, caller, ref, exit_code) do
    receive do
      {:ssh_cm, ^conn, {:data, ^channel, _type, data}} ->
        send(caller, {:stdout, %{ref: ref}, data})
        forward_loop(conn, channel, caller, ref, exit_code)

      {:ssh_cm, ^conn, {:eof, ^channel}} ->
        forward_loop(conn, channel, caller, ref, exit_code)

      {:ssh_cm, ^conn, {:exit_status, ^channel, code}} ->
        forward_loop(conn, channel, caller, ref, code)

      {:ssh_cm, ^conn, {:closed, ^channel}} ->
        send(caller, {:exit, %{ref: ref}, exit_code || 0})

      {:write, data} ->
        :ssh_connection.send(conn, channel, data)
        forward_loop(conn, channel, caller, ref, exit_code)

      {:resize, rows, cols} ->
        :ssh_connection.window_change(conn, channel, cols, rows)
        forward_loop(conn, channel, caller, ref, exit_code)
    after
      @forward_loop_idle_timeout ->
        Logger.warning("SSH forward_loop idle timeout, closing channel")
        :ssh_connection.close(conn, channel)
        send(caller, {:exit, %{ref: ref}, 1})
    end
  end

  # --- Private: SFTP Helpers ---

  defp sftp_mkdir_p(sftp, path) do
    path
    |> Path.split()
    |> Enum.reduce_while("", fn part, acc ->
      dir = if acc == "", do: part, else: Path.join(acc, part)

      case :ssh_sftp.make_dir(sftp, to_charlist(dir)) do
        :ok ->
          {:cont, dir}

        {:error, :failure} ->
          # SFTP :failure is generic — verify it's actually a directory
          case :ssh_sftp.read_file_info(sftp, to_charlist(dir)) do
            {:ok, fi} when file_info(fi, :type) == :directory -> {:cont, dir}
            _ -> {:halt, {:error, {:mkdir_p, dir, :not_a_directory}}}
          end

        {:error, reason} ->
          {:halt, {:error, {:mkdir_p, dir, reason}}}
      end
    end)
    |> case do
      {:error, _} = err -> err
      _dir -> :ok
    end
  end

  # --- Private: Command Building ---

  defp build_command_string(command, []), do: shell_escape(command)

  defp build_command_string(command, args) do
    escaped_args = Enum.map_join(args, " ", &shell_escape/1)
    "#{shell_escape(command)} #{escaped_args}"
  end

  defp build_env_prefix(nil), do: ""
  defp build_env_prefix([]), do: ""

  defp build_env_prefix(env) when is_list(env) do
    exports =
      Enum.map_join(env, " ", fn {k, v} ->
        "export #{shell_escape(to_string(k))}=#{shell_escape(to_string(v))}"
      end)

    exports <> " && "
  end

  defp build_env_prefix(env) when is_map(env) do
    build_env_prefix(Enum.to_list(env))
  end

  defp shell_escape(arg) do
    "'" <> String.replace(arg, "'", "'\\''") <> "'"
  end

  defp call_timeout(opts) do
    (Keyword.get(opts, :timeout, @default_cmd_timeout) || @default_cmd_timeout) + 5_000
  end

  defp ssh_config(key) do
    Application.get_env(:shire, :ssh)[key]
  end

  defp build_setup_ops(conn, sftp, workspace_root) do
    %{
      write: fn path, content ->
        sftp_mkdir_p(sftp, Path.dirname(path))

        case :ssh_sftp.write_file(sftp, to_charlist(path), content) do
          :ok -> :ok
          {:error, reason} -> {:error, reason}
        end
      end,
      mkdir_p: fn path ->
        sftp_mkdir_p(sftp, path)
      end,
      cmd: fn command, args, opts ->
        timeout = Keyword.get(opts, :timeout, @default_cmd_timeout)
        ssh_exec(conn, command, args, opts, workspace_root, timeout)
      end,
      runner_dir: Path.join(workspace_root, ".runner"),
      workspace_root: workspace_root
    }
  end

  defp update_registry_status(project_id, status) do
    Registry.update_value(Shire.ProjectRegistry, {:vm, project_id}, fn _ -> status end)
  end
end
