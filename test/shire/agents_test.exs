defmodule Shire.AgentsTest do
  use Shire.DataCase, async: true

  alias Shire.Agents

  @project "test-project"

  describe "messages" do
    test "create_message/1 with valid data" do
      assert {:ok, msg} =
               Agents.create_message(%{
                 project_name: @project,
                 agent_name: "test-agent",
                 role: "user",
                 content: %{"text" => "hi"}
               })

      assert msg.role == "user"
      assert msg.content == %{"text" => "hi"}
      assert msg.agent_name == "test-agent"
      assert msg.project_name == @project
    end

    test "create_message/1 requires project_name, agent_name and role" do
      assert {:error, changeset} = Agents.create_message(%{})
      assert "can't be blank" in errors_on(changeset).project_name
      assert "can't be blank" in errors_on(changeset).agent_name
      assert "can't be blank" in errors_on(changeset).role
    end

    test "list_messages_for_agent/2 returns messages oldest first" do
      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "chat-agent",
          role: "user",
          content: %{"text" => "first"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "chat-agent",
          role: "agent",
          content: %{"text" => "second"}
        })

      {messages, _has_more} = Agents.list_messages_for_agent(@project, "chat-agent")
      assert length(messages) == 2
      assert Enum.at(messages, 0).content["text"] == "first"
      assert Enum.at(messages, 1).content["text"] == "second"
    end

    test "list_inter_agent_messages/1 returns only inter_agent messages" do
      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "chat-agent",
          role: "user",
          content: %{"text" => "hi"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "chat-agent",
          role: "inter_agent",
          content: %{
            "text" => "Hello from Alice",
            "from_agent" => "Alice",
            "to_agent" => "chat-agent"
          }
        })

      {messages, _has_more} = Agents.list_inter_agent_messages(@project)
      assert length(messages) == 1
      assert hd(messages).role == "inter_agent"
      assert hd(messages).content["from_agent"] == "Alice"
    end

    test "list_inter_agent_messages/2 supports cursor-based pagination" do
      for i <- 1..3 do
        Agents.create_message(%{
          project_name: @project,
          agent_name: "chat-agent",
          role: "inter_agent",
          content: %{
            "text" => "msg-#{i}",
            "from_agent" => "Alice",
            "to_agent" => "chat-agent"
          }
        })
      end

      {first_page, has_more} = Agents.list_inter_agent_messages(@project, limit: 2)
      assert length(first_page) == 2
      assert has_more

      oldest_id = List.last(first_page).id

      {second_page, has_more2} =
        Agents.list_inter_agent_messages(@project, before: oldest_id, limit: 2)

      assert length(second_page) == 1
      refute has_more2
    end

    test "rename_agent_messages/3 updates agent_name on all messages" do
      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "old-agent",
          role: "user",
          content: %{"text" => "hello"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "old-agent",
          role: "agent",
          content: %{"text" => "reply"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "unrelated-agent",
          role: "user",
          content: %{"text" => "keep me"}
        })

      {count, _} = Agents.rename_agent_messages(@project, "old-agent", "new-agent")
      assert count == 2

      {old_msgs, _} = Agents.list_messages_for_agent(@project, "old-agent")
      assert old_msgs == []

      {new_msgs, _} = Agents.list_messages_for_agent(@project, "new-agent")
      assert length(new_msgs) == 2

      {unrelated_msgs, _} = Agents.list_messages_for_agent(@project, "unrelated-agent")
      assert length(unrelated_msgs) == 1
    end

    test "delete_messages_for_agent/2 deletes all messages for an agent" do
      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "delete-test",
          role: "user",
          content: %{"text" => "hi"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_name: @project,
          agent_name: "other-agent",
          role: "user",
          content: %{"text" => "keep me"}
        })

      Agents.delete_messages_for_agent(@project, "delete-test")

      {msgs, _} = Agents.list_messages_for_agent(@project, "delete-test")
      assert msgs == []

      {other_msgs, _} = Agents.list_messages_for_agent(@project, "other-agent")
      assert length(other_msgs) == 1
    end
  end
end
