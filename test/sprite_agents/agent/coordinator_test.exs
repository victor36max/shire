defmodule SpriteAgents.Agent.CoordinatorTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agent.Coordinator
  alias SpriteAgents.Agents

  setup do
    {:ok, agent} =
      Agents.create_agent(%{
        name: "coord-test-agent",
        model: "claude-sonnet-4-6",
        system_prompt: "Test"
      })

    %{agent: agent}
  end

  describe "lookup/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.lookup("nonexistent")
    end
  end

  describe "stop_agent/1" do
    test "returns error when agent is not running" do
      assert {:error, :not_found} = Coordinator.stop_agent("nonexistent")
    end
  end

  describe "list_running/0" do
    test "returns empty list when no agents are running" do
      assert Coordinator.list_running() == []
    end
  end
end
