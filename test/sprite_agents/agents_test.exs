defmodule SpriteAgents.AgentsTest do
  use SpriteAgents.DataCase, async: true

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  describe "agents" do
    test "list_agents/0 returns all agents" do
      {:ok, agent} = Agents.create_agent(%{name: "Test Agent"})
      assert [%Agent{id: id}] = Agents.list_agents()
      assert id == agent.id
    end

    test "get_agent!/1 returns the agent" do
      {:ok, agent} = Agents.create_agent(%{name: "Test Agent"})
      assert Agents.get_agent!(agent.id).id == agent.id
    end

    test "create_agent/1 with valid data" do
      attrs = %{name: "My Agent", model: "claude-sonnet-4-6", system_prompt: "Be helpful"}
      assert {:ok, agent} = Agents.create_agent(attrs)
      assert agent.name == "My Agent"
      assert agent.model == "claude-sonnet-4-6"
      assert agent.system_prompt == "Be helpful"
      assert agent.status == :created
    end

    test "create_agent/1 requires name" do
      assert {:error, changeset} = Agents.create_agent(%{})
      assert "can't be blank" in errors_on(changeset).name
    end

    test "create_agent/1 enforces unique name" do
      {:ok, _} = Agents.create_agent(%{name: "Unique"})
      assert {:error, changeset} = Agents.create_agent(%{name: "Unique"})
      assert "has already been taken" in errors_on(changeset).name
    end

    test "update_agent/2 updates the agent" do
      {:ok, agent} = Agents.create_agent(%{name: "Old Name"})
      assert {:ok, updated} = Agents.update_agent(agent, %{name: "New Name"})
      assert updated.name == "New Name"
    end

    test "delete_agent/1 deletes the agent" do
      {:ok, agent} = Agents.create_agent(%{name: "To Delete"})
      assert {:ok, _} = Agents.delete_agent(agent)
      assert_raise Ecto.NoResultsError, fn -> Agents.get_agent!(agent.id) end
    end

    test "change_agent/2 returns a changeset" do
      {:ok, agent} = Agents.create_agent(%{name: "Test"})
      assert %Ecto.Changeset{} = Agents.change_agent(agent)
    end

    test "get_agent_by_name!/1 returns the agent with given name" do
      {:ok, agent} =
        Agents.create_agent(%{
          name: "named-agent",
          model: "claude-sonnet-4-6",
          system_prompt: "You are a test agent."
        })

      found = Agents.get_agent_by_name!(agent.name)
      assert found.id == agent.id
    end
  end

  describe "secrets" do
    test "create_secret/1 with valid data" do
      assert {:ok, secret} = Agents.create_secret(%{key: "API_KEY", value: "secret123"})
      assert secret.key == "API_KEY"
      assert is_nil(secret.agent_id)
    end

    test "create_secret/1 requires key and value" do
      assert {:error, changeset} = Agents.create_secret(%{})
      assert "can't be blank" in errors_on(changeset).key
      assert "can't be blank" in errors_on(changeset).value
    end

    test "list_global_secrets/0 returns only global secrets" do
      {:ok, agent} = Agents.create_agent(%{name: "Agent"})
      {:ok, _global} = Agents.create_secret(%{key: "GLOBAL_KEY", value: "val"})

      {:ok, _agent_secret} =
        Agents.create_secret(%{key: "AGENT_KEY", value: "val", agent_id: agent.id})

      globals = Agents.list_global_secrets()
      assert length(globals) == 1
      assert hd(globals).key == "GLOBAL_KEY"
    end

    test "list_secrets_for_agent/1 returns only agent secrets" do
      {:ok, agent} = Agents.create_agent(%{name: "Agent"})
      {:ok, _global} = Agents.create_secret(%{key: "GLOBAL_KEY", value: "val"})

      {:ok, _agent_secret} =
        Agents.create_secret(%{key: "AGENT_KEY", value: "val", agent_id: agent.id})

      agent_secrets = Agents.list_secrets_for_agent(agent.id)
      assert length(agent_secrets) == 1
      assert hd(agent_secrets).key == "AGENT_KEY"
    end

    test "effective_secrets/1 merges globals with agent overrides" do
      {:ok, agent} = Agents.create_agent(%{name: "Agent"})
      {:ok, _} = Agents.create_secret(%{key: "SHARED_KEY", value: "global_val"})
      {:ok, _} = Agents.create_secret(%{key: "ONLY_GLOBAL", value: "val"})

      {:ok, _} =
        Agents.create_secret(%{key: "SHARED_KEY", value: "agent_val", agent_id: agent.id})

      {:ok, _} = Agents.create_secret(%{key: "ONLY_AGENT", value: "val", agent_id: agent.id})

      effective = Agents.effective_secrets(agent.id)
      keys = Enum.map(effective, & &1.key) |> Enum.sort()
      assert keys == ["ONLY_AGENT", "ONLY_GLOBAL", "SHARED_KEY"]

      shared = Enum.find(effective, &(&1.key == "SHARED_KEY"))
      assert shared.agent_id == agent.id
    end

    test "update_secret/2 updates the secret" do
      {:ok, secret} = Agents.create_secret(%{key: "KEY", value: "old"})
      assert {:ok, updated} = Agents.update_secret(secret, %{value: "new"})
      assert updated.key == "KEY"
    end

    test "delete_secret/1 deletes the secret" do
      {:ok, secret} = Agents.create_secret(%{key: "KEY", value: "val"})
      assert {:ok, _} = Agents.delete_secret(secret)
      assert_raise Ecto.NoResultsError, fn -> Agents.get_secret!(secret.id) end
    end
  end

  describe "messages" do
    setup do
      {:ok, agent} = Agents.create_agent(%{name: "Chat Agent"})
      %{agent: agent}
    end

    test "create_message/1 with valid data", %{agent: agent} do
      assert {:ok, msg} =
               Agents.create_message(%{
                 agent_id: agent.id,
                 role: "user",
                 content: %{"text" => "hi"}
               })

      assert msg.role == "user"
      assert msg.content == %{"text" => "hi"}
      assert msg.agent_id == agent.id
    end

    test "create_message/1 requires agent_id and role" do
      assert {:error, changeset} = Agents.create_message(%{})
      assert "can't be blank" in errors_on(changeset).agent_id
      assert "can't be blank" in errors_on(changeset).role
    end

    test "list_messages_for_agent/1 returns messages oldest first", %{agent: agent} do
      {:ok, _} =
        Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => "first"}})

      {:ok, _} =
        Agents.create_message(%{
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "second"}
        })

      {messages, _has_more} = Agents.list_messages_for_agent(agent.id)
      assert length(messages) == 2
      assert Enum.at(messages, 0).content["text"] == "first"
      assert Enum.at(messages, 1).content["text"] == "second"
    end

    test "list_messages_for_agent/2 cursor pagination", %{agent: agent} do
      # Create 7 messages
      for i <- 1..7 do
        Agents.create_message(%{
          agent_id: agent.id,
          role: "user",
          content: %{"text" => "msg #{i}"}
        })
      end

      # First page: most recent 3
      {page1, has_more1} = Agents.list_messages_for_agent(agent.id, limit: 3)
      assert length(page1) == 3
      assert has_more1 == true
      assert Enum.at(page1, 0).content["text"] == "msg 5"
      assert Enum.at(page1, 2).content["text"] == "msg 7"

      # Second page: before the oldest message in page1
      cursor = List.first(page1).id
      {page2, has_more2} = Agents.list_messages_for_agent(agent.id, before: cursor, limit: 3)
      assert length(page2) == 3
      assert has_more2 == true
      assert Enum.at(page2, 0).content["text"] == "msg 2"
      assert Enum.at(page2, 2).content["text"] == "msg 4"

      # Third page: only 1 remaining
      cursor2 = List.first(page2).id
      {page3, has_more3} = Agents.list_messages_for_agent(agent.id, before: cursor2, limit: 3)
      assert length(page3) == 1
      assert has_more3 == false
      assert Enum.at(page3, 0).content["text"] == "msg 1"
    end

    test "update_message/2 updates content", %{agent: agent} do
      {:ok, msg} =
        Agents.create_message(%{
          agent_id: agent.id,
          role: "tool_use",
          content: %{"tool" => "Bash", "output" => nil}
        })

      assert {:ok, updated} =
               Agents.update_message(msg, %{content: %{"tool" => "Bash", "output" => "done"}})

      assert updated.content["output"] == "done"
    end

    test "delete_messages_for_agent/1 deletes all messages", %{agent: agent} do
      {:ok, _} =
        Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => "hi"}})

      {:ok, _} =
        Agents.create_message(%{agent_id: agent.id, role: "agent", content: %{"text" => "hey"}})

      {count, _} = Agents.delete_messages_for_agent(agent.id)
      assert count == 2

      {messages, _} = Agents.list_messages_for_agent(agent.id)
      assert messages == []
    end

    test "messages are cascade deleted with agent", %{agent: agent} do
      {:ok, msg} =
        Agents.create_message(%{agent_id: agent.id, role: "user", content: %{"text" => "hi"}})

      {:ok, _} = Agents.delete_agent(agent)
      assert_raise Ecto.NoResultsError, fn -> Agents.get_message!(msg.id) end
    end
  end
end
