defmodule Shire.VirtualMachineLocal do
  @moduledoc """
  Local filesystem + local process implementation of the VirtualMachine behaviour.
  Runs agents as local processes using Erlang ports instead of Sprite VMs.

  Workspace root: `~/.shire/projects/{project_id}/`
  """
  use GenServer
  require Logger

  @behaviour Shire.VirtualMachine

  @default_base_dir Path.expand("~/.shire/projects")

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
    Path.join(base_dir(), project_id)
  end

  # --- Command Execution ---

  @impl Shire.VirtualMachine
  def cmd(project_id, command, args \\ [], opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 30_000)
    env = build_env(Keyword.get(opts, :env))
    dir = Keyword.get(opts, :dir, workspace_root(project_id))

    cmd_opts = [stderr_to_stdout: true, env: env]
    cmd_opts = if File.dir?(dir), do: Keyword.put(cmd_opts, :cd, dir), else: cmd_opts

    task =
      Task.async(fn ->
        cmd_path = System.find_executable(command)

        if cmd_path do
          System.cmd(cmd_path, args, cmd_opts)
        else
          {"command not found: #{command}", 127}
        end
      end)

    case Task.yield(task, timeout) || Task.shutdown(task) do
      {:ok, {output, 0}} ->
        {:ok, output}

      {:ok, {output, code}} ->
        {:error, {:exit, code, output}}

      nil ->
        {:error, :timeout}
    end
  end

  @impl Shire.VirtualMachine
  def cmd!(project_id, command, args \\ [], opts \\ []) do
    case cmd(project_id, command, args, opts) do
      {:ok, output} ->
        output

      {:error, {:exit, code, output}} ->
        raise "Command failed (exit #{code}): #{command} #{Enum.join(args, " ")}\n#{output}"

      {:error, reason} ->
        raise "Command failed: #{command} #{Enum.join(args, " ")} — #{inspect(reason)}"
    end
  end

  # --- Filesystem ---

  @impl Shire.VirtualMachine
  def read(_project_id, path) do
    case File.read(path) do
      {:ok, _} = ok -> ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def write(_project_id, path, content) do
    File.mkdir_p!(Path.dirname(path))

    case File.write(path, content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def mkdir_p(_project_id, path) do
    case File.mkdir_p(path) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def rm(_project_id, path) do
    case File.rm(path) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def rm_rf(_project_id, path) do
    case File.rm_rf(path) do
      {:ok, _} -> :ok
      {:error, reason, _file} -> {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def ls(_project_id, path) do
    case File.ls(path) do
      {:ok, names} ->
        entries =
          Enum.map(names, fn name ->
            full_path = Path.join(path, name)

            case File.stat(full_path) do
              {:ok, %File.Stat{type: type, size: size}} ->
                %{
                  "name" => name,
                  "isDir" => type == :directory,
                  "size" => size
                }

              {:error, _} ->
                %{"name" => name, "isDir" => false, "size" => 0}
            end
          end)

        {:ok, entries}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Shire.VirtualMachine
  def stat(_project_id, path) do
    case File.stat(path) do
      {:ok, %File.Stat{type: type, size: size}} ->
        type_str =
          case type do
            :directory -> "directory"
            _ -> "file"
          end

        {:ok, %{"type" => type_str, "size" => size}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # --- Interactive Process ---

  @impl Shire.VirtualMachine
  def spawn_command(_project_id, command, args \\ [], opts \\ []) do
    caller = self()
    ref = make_ref()
    env = build_port_env(Keyword.get(opts, :env))
    dir = Keyword.get(opts, :dir)
    tty = Keyword.get(opts, :tty, false)

    {exec_path, exec_args} = resolve_executable(command, args, tty)

    port_opts =
      [:binary, :exit_status, :use_stdio, {:args, exec_args}] ++
        if(env != [], do: [{:env, env}], else: []) ++
        if(dir && File.dir?(dir), do: [{:cd, String.to_charlist(dir)}], else: [])

    pid =
      spawn_link(fn ->
        Process.flag(:trap_exit, true)
        port = Port.open({:spawn_executable, exec_path}, port_opts)
        forward_loop(port, caller, ref)
      end)

    {:ok, %{ref: ref, pid: pid}}
  rescue
    e -> {:error, e}
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
  def resize(_command, _rows, _cols), do: :ok

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

    if File.exists?(root) do
      case File.rm_rf(root) do
        {:ok, _} -> :ok
        {:error, reason, file} -> {:error, {reason, file}}
      end
    else
      :ok
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

    File.mkdir_p!(root)

    case Shire.VirtualMachine.Setup.run(build_setup_ops(root)) do
      :ok -> :ok
      {:error, reason} -> Logger.error("Local VM setup failed: #{inspect(reason)}")
    end

    Logger.info("Local VM ready for project #{project_id} at #{root}")
    update_registry_status(project_id, :running)

    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "project:#{project_id}:vm",
      {:vm_ready, project_id}
    )

    {:ok, %{project_id: project_id, root: root}}
  end

  # --- Private ---

  defp base_dir do
    Application.get_env(:shire, :local_vm_base, @default_base_dir)
  end

  defp build_env(nil), do: []
  defp build_env(env) when is_list(env), do: env

  defp build_env(env) when is_map(env) do
    Enum.map(env, fn {k, v} -> {to_string(k), to_string(v)} end)
  end

  defp build_port_env(nil), do: []

  defp build_port_env(env) when is_list(env),
    do: Enum.map(env, fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end)

  defp build_port_env(env) when is_map(env) do
    Enum.map(env, fn {k, v} ->
      {String.to_charlist(to_string(k)), String.to_charlist(to_string(v))}
    end)
  end

  defp resolve_executable(command, args, tty) do
    cmd_path = System.find_executable(command) || command

    if tty do
      case System.find_executable("script") do
        nil ->
          raise "PTY support requires `script` on PATH but it was not found"

        script_path ->
          case :os.type() do
            {:unix, :darwin} ->
              {String.to_charlist(script_path),
               ["-q", "/dev/null", cmd_path | args] |> Enum.map(&String.to_charlist/1)}

            {:unix, _} ->
              full_cmd = Enum.map_join([cmd_path | args], " ", &shell_escape/1)

              {String.to_charlist(script_path),
               ["-qfc", full_cmd, "/dev/null"] |> Enum.map(&String.to_charlist/1)}
          end
      end
    else
      {String.to_charlist(cmd_path), Enum.map(args, &String.to_charlist/1)}
    end
  end

  defp forward_loop(port, caller, ref) do
    receive do
      {^port, {:data, data}} ->
        send(caller, {:stdout, %{ref: ref}, data})
        forward_loop(port, caller, ref)

      {^port, {:exit_status, code}} ->
        send(caller, {:exit, %{ref: ref}, code})

      {:write, data} ->
        try do
          Port.command(port, data)
        rescue
          ArgumentError -> :port_closed
        end

        forward_loop(port, caller, ref)

      {:EXIT, _from, _reason} ->
        Port.close(port)
    end
  end

  defp build_setup_ops(root) do
    %{
      write: fn path, content ->
        File.mkdir_p!(Path.dirname(path))

        case File.write(path, content) do
          :ok -> :ok
          {:error, reason} -> {:error, reason}
        end
      end,
      mkdir_p: fn path ->
        case File.mkdir_p(path) do
          :ok -> :ok
          {:error, reason} -> {:error, reason}
        end
      end,
      cmd: fn command, args, opts ->
        timeout = Keyword.get(opts, :timeout, 30_000)
        cmd_path = System.find_executable(command) || command

        task =
          Task.async(fn ->
            System.cmd(cmd_path, args, stderr_to_stdout: true, cd: root)
          end)

        case Task.yield(task, timeout) || Task.shutdown(task) do
          {:ok, {output, 0}} -> {:ok, output}
          {:ok, {output, code}} -> {:error, {:exit, code, output}}
          nil -> {:error, :timeout}
        end
      end,
      runner_dir: Path.join(root, ".runner"),
      workspace_root: root
    }
  end

  defp shell_escape(arg) do
    "'" <> String.replace(arg, "'", "'\\''") <> "'"
  end

  defp update_registry_status(project_id, status) do
    Registry.update_value(Shire.ProjectRegistry, {:vm, project_id}, fn _ -> status end)
  end
end
