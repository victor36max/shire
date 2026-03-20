defmodule Shire.WorkspaceSettingsTest do
  use Shire.DataCase, async: false

  import Mox

  alias Shire.WorkspaceSettings

  @project "test-project"

  setup do
    Mox.set_mox_global()
    :ok
  end

  describe "read_env/1" do
    test "returns {:ok, string} with VM content" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts ->
        {:ok, "MY_VAR=hello\n"}
      end)

      assert {:ok, content} = WorkspaceSettings.read_env(@project)
      assert content == "MY_VAR=hello\n"
    end

    test "returns {:ok, empty string} when .env does not exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts ->
        {:ok, ""}
      end)

      assert {:ok, ""} = WorkspaceSettings.read_env(@project)
    end
  end

  describe "write_env/2" do
    test "writes content to the VM" do
      expect(Shire.VirtualMachineMock, :write, fn @project, "/workspace/.env", "FOO=bar" ->
        :ok
      end)

      assert :ok = WorkspaceSettings.write_env(@project, "FOO=bar")
    end

    test "returns error on failure" do
      expect(Shire.VirtualMachineMock, :write, fn @project, "/workspace/.env", _content ->
        {:error, :write_failed}
      end)

      assert {:error, :write_failed} = WorkspaceSettings.write_env(@project, "FOO=bar")
    end
  end

  describe "list_scripts/1" do
    test "returns {:ok, []} when no scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts -> {:ok, ""} end)

      assert {:ok, []} = WorkspaceSettings.list_scripts(@project)
    end

    test "returns {:ok, list} with .sh filenames when scripts exist" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts ->
        {:ok, "deploy.sh\nsetup.sh\nreadme.txt\n"}
      end)

      assert {:ok, scripts} = WorkspaceSettings.list_scripts(@project)
      assert "deploy.sh" in scripts
      assert "setup.sh" in scripts
      refute "readme.txt" in scripts
    end
  end

  describe "read_all_scripts/1" do
    test "returns scripts with content" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", ["-c", cmd], _opts ->
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
               WorkspaceSettings.read_all_scripts(@project)
    end

    test "returns empty list when no scripts" do
      stub(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts -> {:ok, ""} end)

      assert {:ok, []} = WorkspaceSettings.read_all_scripts(@project)
    end
  end

  describe "write_script/3" do
    test "writes script and makes it executable" do
      expect(Shire.VirtualMachineMock, :write, fn @project,
                                                  "/workspace/.scripts/setup.sh",
                                                  "#!/bin/bash" ->
        :ok
      end)

      expect(Shire.VirtualMachineMock, :cmd, fn @project,
                                                "chmod",
                                                ["+x", "/workspace/.scripts/setup.sh"],
                                                _opts ->
        {:ok, ""}
      end)

      assert :ok = WorkspaceSettings.write_script(@project, "setup.sh", "#!/bin/bash")
    end
  end

  describe "delete_script/2" do
    test "deletes the script file" do
      expect(Shire.VirtualMachineMock, :cmd, fn @project,
                                                "rm",
                                                ["-f", "/workspace/.scripts/setup.sh"],
                                                _opts ->
        {:ok, ""}
      end)

      assert :ok = WorkspaceSettings.delete_script(@project, "setup.sh")
    end
  end

  describe "read_project_doc/1" do
    test "returns {:ok, string} with VM content" do
      stub(Shire.VirtualMachineMock, :read, fn @project, "/workspace/PROJECT.md" ->
        {:ok, "# My Project\n"}
      end)

      assert {:ok, "# My Project\n"} = WorkspaceSettings.read_project_doc(@project)
    end

    test "returns {:ok, empty string} when PROJECT.md does not exist" do
      stub(Shire.VirtualMachineMock, :read, fn @project, "/workspace/PROJECT.md" ->
        {:error, :not_found}
      end)

      assert {:ok, ""} = WorkspaceSettings.read_project_doc(@project)
    end

    test "returns {:ok, empty string} on VM error" do
      stub(Shire.VirtualMachineMock, :read, fn @project, "/workspace/PROJECT.md" ->
        {:error, :timeout}
      end)

      assert {:ok, ""} = WorkspaceSettings.read_project_doc(@project)
    end
  end

  describe "write_project_doc/2" do
    test "writes content to the VM" do
      expect(Shire.VirtualMachineMock, :write, fn @project,
                                                  "/workspace/PROJECT.md",
                                                  "# Updated" ->
        :ok
      end)

      assert :ok = WorkspaceSettings.write_project_doc(@project, "# Updated")
    end

    test "returns error on failure" do
      expect(Shire.VirtualMachineMock, :write, fn @project, "/workspace/PROJECT.md", _content ->
        {:error, :write_failed}
      end)

      assert {:error, :write_failed} = WorkspaceSettings.write_project_doc(@project, "# Updated")
    end
  end

  describe "run_script/2" do
    test "runs script and returns output" do
      expect(Shire.VirtualMachineMock, :cmd, fn @project, "bash", ["-c", cmd], _opts ->
        assert String.contains?(cmd, "/workspace/.scripts/setup.sh")
        {:ok, "done\n"}
      end)

      assert {:ok, "done\n"} = WorkspaceSettings.run_script(@project, "setup.sh")
    end

    test "returns error on failure" do
      expect(Shire.VirtualMachineMock, :cmd, fn @project, "bash", _args, _opts ->
        {:error, :script_failed}
      end)

      assert {:error, :script_failed} = WorkspaceSettings.run_script(@project, "setup.sh")
    end
  end
end
