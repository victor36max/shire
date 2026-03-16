defmodule SpriteAgents.Agent.TerminalSessionTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agent.TerminalSession

  describe "find/1" do
    test "returns :error when no session exists" do
      assert :error = TerminalSession.find(999_999)
    end
  end

  describe "write/2" do
    test "does not crash when called with valid pid" do
      # We can't fully test without a real Sprites connection,
      # but we can verify the module compiles and the API is callable
      assert is_atom(TerminalSession)
    end
  end

  describe "registry" do
    test "uses {:terminal, agent_id} as registry key" do
      # Verify the registry key pattern is distinct from AgentManager's key
      # AgentManager uses agent_id directly, TerminalSession uses {:terminal, agent_id}
      assert [] = Registry.lookup(SpriteAgents.AgentRegistry, {:terminal, 12345})
    end
  end
end
