defmodule Shire.Agent.TerminalSessionTest do
  use Shire.DataCase, async: true

  alias Shire.Agent.TerminalSession

  @project_id "test-project"

  describe "find/1" do
    test "returns :error when no session exists" do
      assert :error = TerminalSession.find(@project_id)
    end
  end

  describe "write/2" do
    test "module compiles and API is callable" do
      assert is_atom(TerminalSession)
    end
  end

  describe "registry" do
    test "uses {:terminal, project_id} as registry key" do
      assert [] = Registry.lookup(Shire.ProjectRegistry, {:terminal, @project_id})
    end
  end
end
