defmodule Shire.Agents.MessageTest do
  use Shire.DataCase

  alias Shire.Agents.Message

  describe "changeset/2" do
    test "valid roles are accepted" do
      for role <- ["user", "agent", "tool_use", "tool_result", "inter_agent"] do
        changeset = Message.changeset(%Message{}, %{agent_name: "test-agent", role: role, content: %{}})
        assert changeset.valid?, "Expected role #{role} to be valid"
      end
    end

    test "invalid role is rejected" do
      changeset = Message.changeset(%Message{}, %{agent_name: "test-agent", role: "hacker", content: %{}})
      refute changeset.valid?
      assert %{role: ["is invalid"]} = errors_on(changeset)
    end

    test "invalid agent_name format is rejected" do
      changeset = Message.changeset(%Message{}, %{agent_name: "bad name!", role: "user", content: %{}})
      refute changeset.valid?
    end
  end
end
