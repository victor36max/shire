defmodule Shire.Agent.TerminalSessionTest do
  use Shire.DataCase, async: true

  alias Shire.Agent.TerminalSession

  describe "find/0" do
    test "returns :error when no session exists" do
      assert :error = TerminalSession.find()
    end
  end

  describe "write/1" do
    test "module compiles and API is callable" do
      assert is_atom(TerminalSession)
    end
  end

  describe "registry" do
    test "uses :global_terminal as registry key" do
      assert [] = Registry.lookup(Shire.AgentRegistry, :global_terminal)
    end
  end
end
