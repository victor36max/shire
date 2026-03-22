defmodule Shire.VirtualMachineLocalTest do
  use ExUnit.Case, async: true

  alias Shire.VirtualMachineLocal, as: Local

  setup do
    tmp = Path.join(System.tmp_dir!(), "shire_local_test_#{:erlang.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    Application.put_env(:shire, :local_vm_base, tmp)

    on_exit(fn ->
      File.rm_rf!(tmp)
      Application.delete_env(:shire, :local_vm_base)
    end)

    project_id = "proj-#{:erlang.unique_integer([:positive])}"
    root = Path.join(tmp, project_id)

    %{tmp: tmp, project_id: project_id, root: root}
  end

  describe "workspace_root/1" do
    test "returns path under base dir", %{tmp: tmp, project_id: project_id} do
      assert Local.workspace_root(project_id) == Path.join(tmp, project_id)
    end
  end

  describe "filesystem operations" do
    setup %{project_id: project_id, root: root} do
      File.mkdir_p!(root)
      %{project_id: project_id, root: root}
    end

    test "write/3 creates file and parent dirs", %{project_id: pid, root: root} do
      path = Path.join([root, "sub", "dir", "test.txt"])
      assert :ok = Local.write(pid, path, "hello")
      assert File.read!(path) == "hello"
    end

    test "read/2 reads file content", %{project_id: pid, root: root} do
      path = Path.join(root, "read_test.txt")
      File.write!(path, "content here")
      assert {:ok, "content here"} = Local.read(pid, path)
    end

    test "read/2 returns error for missing file", %{project_id: pid, root: root} do
      path = Path.join(root, "nonexistent.txt")
      assert {:error, :enoent} = Local.read(pid, path)
    end

    test "mkdir_p/2 creates nested dirs", %{project_id: pid, root: root} do
      path = Path.join([root, "a", "b", "c"])
      assert :ok = Local.mkdir_p(pid, path)
      assert File.dir?(path)
    end

    test "rm/2 removes a file", %{project_id: pid, root: root} do
      path = Path.join(root, "to_delete.txt")
      File.write!(path, "bye")
      assert :ok = Local.rm(pid, path)
      refute File.exists?(path)
    end

    test "rm/2 returns error for missing file", %{project_id: pid, root: root} do
      path = Path.join(root, "nope.txt")
      assert {:error, :enoent} = Local.rm(pid, path)
    end

    test "rm_rf/2 removes directory tree", %{project_id: pid, root: root} do
      dir = Path.join(root, "tree")
      File.mkdir_p!(Path.join(dir, "nested"))
      File.write!(Path.join(dir, "nested/file.txt"), "data")
      assert :ok = Local.rm_rf(pid, dir)
      refute File.exists?(dir)
    end

    test "ls/2 returns entries with correct format", %{project_id: pid, root: root} do
      File.mkdir_p!(Path.join(root, "subdir"))
      File.write!(Path.join(root, "file.txt"), "hello")

      assert {:ok, entries} = Local.ls(pid, root)
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
      assert {:error, :enoent} = Local.ls(pid, Path.join(root, "nope"))
    end

    test "stat/2 returns file info", %{project_id: pid, root: root} do
      path = Path.join(root, "stat_test.txt")
      File.write!(path, "12345")
      assert {:ok, info} = Local.stat(pid, path)
      assert info["type"] == "file"
      assert info["size"] == 5
    end

    test "stat/2 returns dir info", %{project_id: pid, root: root} do
      dir = Path.join(root, "stat_dir")
      File.mkdir_p!(dir)
      assert {:ok, info} = Local.stat(pid, dir)
      assert info["type"] == "directory"
    end

    test "stat/2 returns error for missing path", %{project_id: pid, root: root} do
      assert {:error, :enoent} = Local.stat(pid, Path.join(root, "nope"))
    end
  end

  describe "cmd/4" do
    test "runs a command and returns output", %{project_id: pid} do
      assert {:ok, output} = Local.cmd(pid, "echo", ["hello"])
      assert String.trim(output) == "hello"
    end

    test "returns error for failing command", %{project_id: pid} do
      assert {:error, {:exit, code, _output}} = Local.cmd(pid, "false", [])
      assert code > 0
    end

    test "passes environment variables", %{project_id: pid} do
      assert {:ok, output} =
               Local.cmd(pid, "sh", ["-c", "echo $MY_VAR"], env: %{"MY_VAR" => "test_val"})

      assert String.trim(output) == "test_val"
    end
  end

  describe "cmd!/4" do
    test "returns output on success", %{project_id: pid} do
      assert String.trim(Local.cmd!(pid, "echo", ["world"])) == "world"
    end

    test "raises on failure", %{project_id: pid} do
      assert_raise RuntimeError, fn ->
        Local.cmd!(pid, "false", [])
      end
    end
  end

  describe "spawn_command/4" do
    test "spawns process and receives stdout and exit", %{project_id: pid} do
      assert {:ok, command} = Local.spawn_command(pid, "echo", ["hello spawn"])
      assert is_reference(command.ref)

      assert_receive {:stdout, %{ref: ref}, data}, 5_000
      assert ref == command.ref
      assert String.contains?(data, "hello spawn")

      assert_receive {:exit, %{ref: ref}, 0}, 5_000
      assert ref == command.ref
    end

    test "write_stdin sends data to process", %{project_id: pid} do
      # Use head -1 which reads one line then exits
      assert {:ok, command} = Local.spawn_command(pid, "head", ["-1"])
      assert is_reference(command.ref)

      :ok = Local.write_stdin(command, "ping\n")

      assert_receive {:stdout, %{ref: _}, data}, 5_000
      assert String.contains?(data, "ping")

      assert_receive {:exit, %{ref: _}, 0}, 5_000
    end

    test "resize returns :ok", %{project_id: pid} do
      assert {:ok, command} = Local.spawn_command(pid, "echo", ["hi"])
      assert :ok = Local.resize(command, 30, 100)
      # Drain messages
      assert_receive {:exit, _, _}, 5_000
    end

    test "reports non-zero exit code", %{project_id: pid} do
      assert {:ok, command} = Local.spawn_command(pid, "sh", ["-c", "exit 42"])

      assert_receive {:exit, %{ref: ref}, 42}, 5_000
      assert ref == command.ref
    end

    test "passes env vars to spawned process", %{project_id: pid} do
      assert {:ok, _command} =
               Local.spawn_command(pid, "sh", ["-c", "echo $SPAWN_VAR"],
                 env: %{"SPAWN_VAR" => "spawned"}
               )

      assert_receive {:stdout, _, data}, 5_000
      assert String.contains?(data, "spawned")
      assert_receive {:exit, _, 0}, 5_000
    end
  end

  describe "destroy_vm/1" do
    test "removes workspace directory", %{project_id: pid, root: root} do
      File.mkdir_p!(root)
      File.write!(Path.join(root, "test.txt"), "data")
      assert :ok = Local.destroy_vm(pid)
      refute File.exists?(root)
    end

    test "returns :ok if dir doesn't exist", %{project_id: pid} do
      assert :ok = Local.destroy_vm(pid)
    end
  end

  describe "vm_status/1 and touch_keepalive/1" do
    test "touch_keepalive returns :ok", %{project_id: pid} do
      assert :ok = Local.touch_keepalive(pid)
    end
  end
end
