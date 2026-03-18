defmodule Shire.WorkspaceSettingsTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.WorkspaceSettings

  setup do
    Mox.set_mox_global()
    :ok
  end

  describe "read_env/0" do
    test "returns {:ok, string} with VM content" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "MY_VAR=hello\n"}
      end)

      assert {:ok, content} = WorkspaceSettings.read_env()
      assert content == "MY_VAR=hello\n"
    end

    test "returns {:ok, empty string} when .env does not exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, ""}
      end)

      assert {:ok, ""} = WorkspaceSettings.read_env()
    end
  end

  describe "write_env/1" do
    test "writes content to the VM" do
      expect(Shire.VirtualMachineMock, :write, fn "/workspace/.env", "FOO=bar" -> :ok end)

      assert :ok = WorkspaceSettings.write_env("FOO=bar")
    end

    test "returns error on failure" do
      expect(Shire.VirtualMachineMock, :write, fn "/workspace/.env", _content ->
        {:error, :write_failed}
      end)

      assert {:error, :write_failed} = WorkspaceSettings.write_env("FOO=bar")
    end
  end

  describe "list_scripts/0" do
    test "returns {:ok, []} when no scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts -> {:ok, ""} end)

      assert {:ok, []} = WorkspaceSettings.list_scripts()
    end

    test "returns {:ok, list} with .sh filenames when scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:ok, "deploy.sh\nsetup.sh\nreadme.txt\n"}
      end)

      assert {:ok, scripts} = WorkspaceSettings.list_scripts()
      assert "deploy.sh" in scripts
      assert "setup.sh" in scripts
      refute "readme.txt" in scripts
    end
  end

  describe "read_all_scripts/0" do
    test "returns scripts with content" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", ["-c", cmd], _opts ->
        cond do
          String.contains?(cmd, "ls /workspace/.scripts") ->
            {:ok, "setup.sh\n"}

          String.contains?(cmd, "cat /workspace/.scripts/setup.sh") ->
            {:ok, "#!/bin/bash\necho hi"}

          true ->
            {:ok, ""}
        end
      end)

      assert {:ok, [%{name: "setup.sh", content: "#!/bin/bash\necho hi"}]} =
               WorkspaceSettings.read_all_scripts()
    end

    test "returns empty list when no scripts" do
      stub(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts -> {:ok, ""} end)

      assert {:ok, []} = WorkspaceSettings.read_all_scripts()
    end
  end

  describe "write_script/2" do
    test "writes script and makes it executable" do
      expect(Shire.VirtualMachineMock, :write, fn "/workspace/.scripts/setup.sh", "#!/bin/bash" ->
        :ok
      end)

      expect(Shire.VirtualMachineMock, :cmd, fn "chmod",
                                                ["+x", "/workspace/.scripts/setup.sh"],
                                                _opts ->
        {:ok, ""}
      end)

      assert :ok = WorkspaceSettings.write_script("setup.sh", "#!/bin/bash")
    end
  end

  describe "delete_script/1" do
    test "deletes the script file" do
      expect(Shire.VirtualMachineMock, :cmd, fn "rm",
                                                ["-f", "/workspace/.scripts/setup.sh"],
                                                _opts ->
        {:ok, ""}
      end)

      assert :ok = WorkspaceSettings.delete_script("setup.sh")
    end
  end

  describe "run_script/1" do
    test "runs script and returns output" do
      expect(Shire.VirtualMachineMock, :cmd, fn "bash", ["-c", cmd], _opts ->
        assert String.contains?(cmd, "/workspace/.scripts/setup.sh")
        {:ok, "done\n"}
      end)

      assert {:ok, "done\n"} = WorkspaceSettings.run_script("setup.sh")
    end

    test "returns error on failure" do
      expect(Shire.VirtualMachineMock, :cmd, fn "bash", _args, _opts ->
        {:error, :script_failed}
      end)

      assert {:error, :script_failed} = WorkspaceSettings.run_script("setup.sh")
    end
  end
end
