defmodule Shire.VirtualMachineSSHTest do
  @moduledoc """
  Tests for VirtualMachineSSH. Requires a reachable SSH server.

  Run with: mix test --include ssh

  Configure via env vars:
    SHIRE_SSH_HOST (default: localhost)
    SHIRE_SSH_PORT (default: 22)
    SHIRE_SSH_USER (default: current user)
    SHIRE_SSH_KEY  (default: ~/.ssh/id_ed25519)
  """
  use ExUnit.Case, async: false

  @moduletag :ssh

  alias Shire.VirtualMachineSSH, as: SSH

  setup_all do
    host = System.get_env("SHIRE_SSH_HOST", "localhost")
    user = System.get_env("SHIRE_SSH_USER", System.get_env("USER"))
    key = System.get_env("SHIRE_SSH_KEY", Path.expand("~/.ssh/id_ed25519"))
    port = String.to_integer(System.get_env("SHIRE_SSH_PORT", "22"))

    workspace_root =
      System.get_env("SHIRE_SSH_WORKSPACE_ROOT", "/tmp/shire_ssh_test_#{System.os_time(:second)}")

    Application.put_env(:shire, :ssh,
      host: host,
      port: port,
      user: user,
      key_path: key,
      workspace_root: workspace_root
    )

    on_exit(fn ->
      Application.delete_env(:shire, :ssh)
    end)

    %{workspace_root: workspace_root}
  end

  setup %{workspace_root: workspace_root} do
    project_id = "test-#{:erlang.unique_integer([:positive])}"
    root = Path.join(workspace_root, project_id)

    # Start the GenServer — this creates the workspace and runs setup
    start_supervised!(
      {Shire.VirtualMachineSSH, [project_id: project_id]},
      restart: :temporary
    )

    on_exit(fn ->
      # Clean up remote workspace
      try do
        SSH.cmd(project_id, "rm", ["-rf", root])
      rescue
        _ -> :ok
      catch
        _, _ -> :ok
      end
    end)

    %{project_id: project_id, root: root}
  end

  describe "workspace_root/1" do
    test "returns path under configured root", %{project_id: project_id, root: root} do
      assert SSH.workspace_root(project_id) == root
    end
  end

  describe "filesystem operations" do
    test "write/3 creates file and parent dirs", %{project_id: pid, root: root} do
      path = Path.join([root, "sub", "dir", "test.txt"])
      assert :ok = SSH.write(pid, path, "hello")
      assert {:ok, "hello"} = SSH.read(pid, path)
    end

    test "read/2 reads file content", %{project_id: pid, root: root} do
      path = Path.join(root, "read_test.txt")
      :ok = SSH.write(pid, path, "content here")
      assert {:ok, "content here"} = SSH.read(pid, path)
    end

    test "read/2 returns error for missing file", %{project_id: pid, root: root} do
      path = Path.join(root, "nonexistent.txt")
      assert {:error, _reason} = SSH.read(pid, path)
    end

    test "mkdir_p/2 creates nested dirs", %{project_id: pid, root: root} do
      path = Path.join([root, "a", "b", "c"])
      assert :ok = SSH.mkdir_p(pid, path)
      assert {:ok, info} = SSH.stat(pid, path)
      assert info["type"] == "directory"
    end

    test "rm/2 removes a file", %{project_id: pid, root: root} do
      path = Path.join(root, "to_delete.txt")
      :ok = SSH.write(pid, path, "bye")
      assert :ok = SSH.rm(pid, path)
      assert {:error, _} = SSH.read(pid, path)
    end

    test "rm/2 returns error for missing file", %{project_id: pid, root: root} do
      path = Path.join(root, "nope.txt")
      assert {:error, _} = SSH.rm(pid, path)
    end

    test "rm_rf/2 removes directory tree", %{project_id: pid, root: root} do
      dir = Path.join(root, "tree")
      :ok = SSH.mkdir_p(pid, Path.join(dir, "nested"))
      :ok = SSH.write(pid, Path.join(dir, "nested/file.txt"), "data")
      assert :ok = SSH.rm_rf(pid, dir)
      assert {:error, _} = SSH.stat(pid, dir)
    end

    test "ls/2 returns entries with correct format", %{project_id: pid, root: root} do
      test_dir = Path.join(root, "ls_test")
      :ok = SSH.mkdir_p(pid, Path.join(test_dir, "subdir"))
      :ok = SSH.write(pid, Path.join(test_dir, "file.txt"), "hello")

      assert {:ok, entries} = SSH.ls(pid, test_dir)
      assert is_list(entries)

      names = Enum.map(entries, & &1["name"])
      assert "subdir" in names
      assert "file.txt" in names

      dir_entry = Enum.find(entries, &(&1["name"] == "subdir"))
      assert dir_entry["isDir"] == true

      file_entry = Enum.find(entries, &(&1["name"] == "file.txt"))
      assert file_entry["isDir"] == false
      assert file_entry["size"] == 5
    end

    test "ls/2 returns error for missing dir", %{project_id: pid, root: root} do
      assert {:error, _} = SSH.ls(pid, Path.join(root, "nope"))
    end

    test "stat/2 returns file info", %{project_id: pid, root: root} do
      path = Path.join(root, "stat_test.txt")
      :ok = SSH.write(pid, path, "12345")
      assert {:ok, info} = SSH.stat(pid, path)
      assert info["type"] == "file"
      assert info["size"] == 5
    end

    test "stat/2 returns dir info", %{project_id: pid, root: root} do
      dir = Path.join(root, "stat_dir")
      :ok = SSH.mkdir_p(pid, dir)
      assert {:ok, info} = SSH.stat(pid, dir)
      assert info["type"] == "directory"
    end

    test "stat/2 returns error for missing path", %{project_id: pid, root: root} do
      assert {:error, _} = SSH.stat(pid, Path.join(root, "nope"))
    end
  end

  describe "cmd/4" do
    test "runs a command and returns output", %{project_id: pid} do
      assert {:ok, output} = SSH.cmd(pid, "echo", ["hello"])
      assert String.trim(output) == "hello"
    end

    test "returns error for failing command", %{project_id: pid} do
      assert {:error, {:exit, code, _output}} = SSH.cmd(pid, "false", [])
      assert code > 0
    end

    test "passes environment variables", %{project_id: pid} do
      assert {:ok, output} =
               SSH.cmd(pid, "sh", ["-c", "echo $MY_VAR"], env: %{"MY_VAR" => "test_val"})

      assert String.trim(output) == "test_val"
    end
  end

  describe "cmd!/4" do
    test "returns output on success", %{project_id: pid} do
      assert String.trim(SSH.cmd!(pid, "echo", ["world"])) == "world"
    end

    test "raises on failure", %{project_id: pid} do
      assert_raise RuntimeError, fn ->
        SSH.cmd!(pid, "false", [])
      end
    end
  end

  describe "spawn_command/4" do
    test "spawns process and receives stdout and exit", %{project_id: pid} do
      assert {:ok, command} = SSH.spawn_command(pid, "echo", ["hello spawn"])
      assert is_reference(command.ref)

      assert_receive {:stdout, %{ref: ref}, data}, 5_000
      assert ref == command.ref
      assert String.contains?(data, "hello spawn")

      assert_receive {:exit, %{ref: ref}, 0}, 5_000
      assert ref == command.ref
    end

    test "write_stdin sends data to process", %{project_id: pid} do
      assert {:ok, command} = SSH.spawn_command(pid, "head", ["-1"])
      assert is_reference(command.ref)

      :ok = SSH.write_stdin(command, "ping\n")

      assert_receive {:stdout, %{ref: _}, data}, 5_000
      assert String.contains?(data, "ping")

      assert_receive {:exit, %{ref: _}, 0}, 5_000
    end

    test "resize returns :ok", %{project_id: pid} do
      assert {:ok, command} = SSH.spawn_command(pid, "echo", ["hi"])
      assert :ok = SSH.resize(command, 30, 100)
      assert_receive {:exit, _, _}, 5_000
    end

    test "reports non-zero exit code", %{project_id: pid} do
      assert {:ok, command} = SSH.spawn_command(pid, "sh", ["-c", "exit 42"])

      assert_receive {:exit, %{ref: ref}, 42}, 5_000
      assert ref == command.ref
    end

    test "passes env vars to spawned process", %{project_id: pid} do
      assert {:ok, _command} =
               SSH.spawn_command(pid, "sh", ["-c", "echo $SPAWN_VAR"],
                 env: %{"SPAWN_VAR" => "spawned"}
               )

      assert_receive {:stdout, _, data}, 5_000
      assert String.contains?(data, "spawned")
      assert_receive {:exit, _, 0}, 5_000
    end
  end

  describe "vm_status/1 and touch_keepalive/1" do
    test "vm_status returns :running after init", %{project_id: pid} do
      assert SSH.vm_status(pid) == :running
    end

    test "touch_keepalive returns :ok", %{project_id: pid} do
      assert :ok = SSH.touch_keepalive(pid)
    end
  end
end
