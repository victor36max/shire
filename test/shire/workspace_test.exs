defmodule Shire.WorkspaceTest do
  use ExUnit.Case, async: false

  import Mox

  alias Shire.Workspace

  @project_id "test-project-id"

  setup do
    Mox.set_mox_global()
    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)
    :ok
  end

  describe "root/1" do
    test "returns workspace root for project" do
      assert Workspace.root(@project_id) == "/workspace"
    end
  end

  describe "agents_dir/1" do
    test "returns agents directory under workspace root" do
      assert Workspace.agents_dir(@project_id) == "/workspace/agents"
    end
  end

  describe "agent_dir/2" do
    test "returns agent directory under agents dir" do
      assert Workspace.agent_dir(@project_id, "agent-123") == "/workspace/agents/agent-123"
    end
  end

  describe "shared_dir/1" do
    test "returns shared directory" do
      assert Workspace.shared_dir(@project_id) == "/workspace/shared"
    end
  end

  describe "env_path/1" do
    test "returns .env path" do
      assert Workspace.env_path(@project_id) == "/workspace/.env"
    end
  end

  describe "scripts_dir/1" do
    test "returns .scripts directory" do
      assert Workspace.scripts_dir(@project_id) == "/workspace/.scripts"
    end
  end

  describe "script_path/2" do
    test "returns path to a named script" do
      assert Workspace.script_path(@project_id, "setup.sh") == "/workspace/.scripts/setup.sh"
    end
  end

  describe "runner_dir/1" do
    test "returns .runner directory" do
      assert Workspace.runner_dir(@project_id) == "/workspace/.runner"
    end
  end

  describe "peers_path/1" do
    test "returns peers.yaml path" do
      assert Workspace.peers_path(@project_id) == "/workspace/peers.yaml"
    end
  end

  describe "project_doc_path/1" do
    test "returns PROJECT.md path" do
      assert Workspace.project_doc_path(@project_id) == "/workspace/PROJECT.md"
    end
  end
end
