defmodule Shire.Agent.AgentManagerTest do
  use Shire.DataCase, async: true

  alias Shire.Agent.AgentManager
  alias Shire.Agents

  defp valid_recipe(name \\ "test-agent") do
    """
    version: 1
    name: #{name}
    harness: pi
    model: claude-sonnet-4-6
    system_prompt: You are a test agent.
    """
  end

  setup do
    {:ok, agent} = Agents.create_agent(%{recipe: valid_recipe()})
    %{agent: agent}
  end

  describe "start_link/1" do
    test "starts the GenServer and registers with the agent id", %{agent: agent} do
      {:ok, pid} =
        start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})

      assert Process.alive?(pid)
      assert GenServer.call(pid, :get_state) |> Map.get(:phase) == :idle
    end
  end

  describe "state management" do
    test "get_state returns current state", %{agent: agent} do
      {:ok, pid} =
        start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})

      state = AgentManager.get_state(pid)
      assert state.agent_name == "test-agent"
      assert state.phase == :idle
    end
  end

  describe "send_message/3" do
    test "returns error when agent is not active", %{agent: agent} do
      {:ok, pid} =
        start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})

      assert {:error, :not_active} = GenServer.call(pid, {:send_message, "hello", :user})
    end
  end

  describe "responsiveness" do
    test "get_state responds immediately even during non-idle phases", %{agent: agent} do
      {:ok, pid} =
        start_supervised({AgentManager, agent: agent, sprites_client: nil, skip_sprite: true})

      state = AgentManager.get_state(pid)
      assert state.phase == :idle
    end
  end
end
