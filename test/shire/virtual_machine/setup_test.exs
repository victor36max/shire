defmodule Shire.VirtualMachine.SetupTest do
  use ExUnit.Case, async: true

  alias Shire.VirtualMachine.Setup

  setup do
    # Track all calls made through ops closures
    test_pid = self()

    ops = %{
      write: fn path, content ->
        send(test_pid, {:write, path, content})
        :ok
      end,
      mkdir_p: fn path ->
        send(test_pid, {:mkdir_p, path})
        :ok
      end,
      cmd: fn command, args, opts ->
        send(test_pid, {:cmd, command, args, opts})
        {:ok, ""}
      end,
      runner_dir: "/workspace/.runner",
      workspace_root: "/workspace"
    }

    %{ops: ops}
  end

  describe "deploy_runner_files/1" do
    test "deploys agent-runner.ts, package.json, and bun.lock to runner dir", %{ops: ops} do
      assert :ok = Setup.deploy_runner_files(ops)

      assert_received {:mkdir_p, "/workspace/.runner"}
      assert_received {:write, "/workspace/.runner/agent-runner.ts", content}
      assert is_binary(content) and byte_size(content) > 0

      assert_received {:write, "/workspace/.runner/package.json", pkg}
      assert is_binary(pkg) and byte_size(pkg) > 0

      assert_received {:write, "/workspace/.runner/bun.lock", lock}
      assert is_binary(lock) and byte_size(lock) > 0
    end

    test "deploys harness files excluding test files", %{ops: ops} do
      assert :ok = Setup.deploy_runner_files(ops)

      assert_received {:mkdir_p, "/workspace/.runner/harness"}

      # Should deploy production harness files
      assert_received {:write, "/workspace/.runner/harness/index.ts", _}
      assert_received {:write, "/workspace/.runner/harness/types.ts", _}
      assert_received {:write, "/workspace/.runner/harness/claude-code-harness.ts", _}
      assert_received {:write, "/workspace/.runner/harness/pi-harness.ts", _}

      # Should NOT deploy test files
      refute_received {:write, "/workspace/.runner/harness/claude-code-harness.test.ts", _}
      refute_received {:write, "/workspace/.runner/harness/pi-harness.test.ts", _}
    end
  end

  describe "run_bootstrap/1" do
    test "reads and executes bootstrap.sh with workspace root arg", %{ops: ops} do
      assert :ok = Setup.run_bootstrap(ops)

      assert_received {:cmd, "bash", ["-c", script, "bash", "/workspace"], opts}
      assert is_binary(script)
      assert String.contains?(script, "WORKSPACE_ROOT")
      assert Keyword.get(opts, :timeout) == 300_000
    end
  end

  describe "run/1" do
    test "deploys runner files then runs bootstrap", %{ops: ops} do
      assert :ok = Setup.run(ops)

      # Verify runner files were deployed
      assert_received {:mkdir_p, "/workspace/.runner"}
      assert_received {:write, "/workspace/.runner/agent-runner.ts", _}

      # Verify bootstrap was run
      assert_received {:cmd, "bash", ["-c", _, "bash", "/workspace"], _}
    end

    test "returns error if deploy_runner_files fails", %{ops: ops} do
      failing_ops = %{ops | mkdir_p: fn _path -> {:error, :eacces} end}

      assert {:error, :eacces} = Setup.run(failing_ops)
    end

    test "returns error if bootstrap fails", %{ops: ops} do
      failing_ops = %{ops | cmd: fn _cmd, _args, _opts -> {:error, {:exit, 1, "failed"}} end}

      assert {:error, {:exit, 1, "failed"}} = Setup.run(failing_ops)
    end
  end
end
