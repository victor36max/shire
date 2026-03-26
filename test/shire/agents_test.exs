defmodule Shire.AgentsTest do
  use Shire.DataCase, async: true

  import Mox

  alias Shire.Agents
  alias Shire.Projects

  @vm Shire.VirtualMachineStub

  setup :set_mox_from_context

  setup do
    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)

    {:ok, project} = Projects.create_project("test-project")
    {:ok, agent} = Agents.create_agent_with_vm(project.id, "test-agent", "version: 1\n", @vm)
    {:ok, agent2} = Agents.create_agent_with_vm(project.id, "chat-agent", "version: 1\n", @vm)

    %{project: project, agent: agent, agent2: agent2}
  end

  describe "messages" do
    test "create_message/1 with valid data", %{project: project, agent: agent} do
      assert {:ok, msg} =
               Agents.create_message(%{
                 project_id: project.id,
                 agent_id: agent.id,
                 role: "user",
                 content: %{"text" => "hi"}
               })

      assert msg.role == "user"
      assert msg.content == %{"text" => "hi"}
      assert msg.agent_id == agent.id
      assert msg.project_id == project.id
    end

    test "create_message/1 requires project_id, agent_id and role" do
      assert {:error, changeset} = Agents.create_message(%{})
      assert "can't be blank" in errors_on(changeset).project_id
      assert "can't be blank" in errors_on(changeset).agent_id
      assert "can't be blank" in errors_on(changeset).role
    end

    test "list_messages_for_agent/2 returns messages oldest first", %{
      project: project,
      agent2: agent
    } do
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "user",
          content: %{"text" => "first"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "second"}
        })

      {messages, _has_more} = Agents.list_messages_for_agent(project.id, agent.id)
      assert length(messages) == 2
      assert Enum.at(messages, 0).content["text"] == "first"
      assert Enum.at(messages, 1).content["text"] == "second"
    end

    test "list_inter_agent_messages/1 returns only inter_agent messages", %{
      project: project,
      agent2: agent
    } do
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "user",
          content: %{"text" => "hi"}
        })

      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "inter_agent",
          content: %{
            "text" => "Hello from Alice",
            "from_agent" => "Alice",
            "to_agent" => "chat-agent"
          }
        })

      {messages, _has_more} = Agents.list_inter_agent_messages(project.id)
      assert length(messages) == 1
      assert hd(messages).role == "inter_agent"
      assert hd(messages).content["from_agent"] == "Alice"
    end

    test "list_inter_agent_messages/2 supports cursor-based pagination", %{
      project: project,
      agent2: agent
    } do
      for i <- 1..3 do
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "inter_agent",
          content: %{
            "text" => "msg-#{i}",
            "from_agent" => "Alice",
            "to_agent" => "chat-agent"
          }
        })
      end

      {first_page, has_more} = Agents.list_inter_agent_messages(project.id, limit: 2)
      assert length(first_page) == 2
      assert has_more

      oldest_id = List.last(first_page).id

      {second_page, has_more2} =
        Agents.list_inter_agent_messages(project.id, before: oldest_id, limit: 2)

      assert length(second_page) == 1
      refute has_more2
    end

    test "send_message_with_inbox/6 inserts message and writes inbox file", %{
      project: project,
      agent: agent
    } do
      inbox_path = "/workspace/agents/#{agent.id}/inbox/msg-1.yaml"
      envelope = %{"role" => "user", "content" => "hello"}

      assert {:ok, msg} =
               Agents.send_message_with_inbox(
                 project.id,
                 agent.id,
                 "hello",
                 inbox_path,
                 envelope,
                 @vm
               )

      assert msg.role == "user"
      assert msg.content == %{"text" => "hello"}
      assert msg.agent_id == agent.id
      assert msg.project_id == project.id
    end

    test "send_message_with_inbox/6 rolls back message on VM write failure", %{
      project: project,
      agent: agent
    } do
      defmodule FailingWriteVM do
        @behaviour Shire.VirtualMachine
        def cmd(_p, _c, _a \\ [], _o \\ []), do: {:ok, ""}
        def cmd!(_p, _c, _a \\ [], _o \\ []), do: ""
        def read(_p, _path), do: {:ok, ""}
        def write(_p, _path, _content), do: {:error, :disk_full}
        def mkdir_p(_p, _path), do: :ok
        def rm(_p, _path), do: :ok
        def rm_rf(_p, _path), do: :ok
        def ls(_p, _path), do: {:ok, []}
        def stat(_p, _path), do: {:ok, %{type: :file, size: 0}}
        def spawn_command(_p, _c, _a \\ [], _o \\ []), do: {:error, :not_available}
        def write_stdin(_c, _d), do: :ok
        def resize(_c, _r, _cols), do: :ok

        def workspace_root(_p), do: "/workspace"
        def touch_keepalive(_p), do: :ok
        def vm_status(_p), do: :running
        def destroy_vm(_p), do: :ok
      end

      inbox_path = "/workspace/agents/#{agent.id}/inbox/msg-2.yaml"
      envelope = %{"role" => "user", "content" => "fail"}

      assert {:error, :disk_full} =
               Agents.send_message_with_inbox(
                 project.id,
                 agent.id,
                 "fail",
                 inbox_path,
                 envelope,
                 FailingWriteVM
               )

      # Message should not have been persisted
      {messages, _} = Agents.list_messages_for_agent(project.id, agent.id)
      refute Enum.any?(messages, &(&1.content["text"] == "fail"))
    end

    test "send_message_with_inbox stores attachments in content map", %{
      project: project,
      agent: agent
    } do
      inbox_path = "/workspace/agents/#{agent.id}/inbox/msg-att.yaml"
      envelope = %{"role" => "user", "content" => "with files"}

      attachments = [
        %{
          "id" => "abc12345",
          "filename" => "report.pdf",
          "size" => 1024,
          "content_type" => "application/pdf"
        }
      ]

      assert {:ok, msg} =
               Agents.send_message_with_inbox(
                 project.id,
                 agent.id,
                 "check this file",
                 inbox_path,
                 envelope,
                 @vm,
                 attachments: attachments
               )

      assert msg.content["text"] == "check this file"
      assert msg.content["attachments"] == attachments
    end

    test "send_message_with_inbox omits attachments key when empty", %{
      project: project,
      agent: agent
    } do
      inbox_path = "/workspace/agents/#{agent.id}/inbox/msg-noatt.yaml"
      envelope = %{"role" => "user", "content" => "no files"}

      assert {:ok, msg} =
               Agents.send_message_with_inbox(
                 project.id,
                 agent.id,
                 "just text",
                 inbox_path,
                 envelope,
                 @vm,
                 attachments: []
               )

      assert msg.content == %{"text" => "just text"}
      refute Map.has_key?(msg.content, "attachments")
    end

    test "unread_counts/2 returns 0 for agents with no messages", %{
      agent: agent,
      agent2: agent2
    } do
      agents = [
        %{id: agent.id, last_read_message_id: nil},
        %{id: agent2.id, last_read_message_id: nil}
      ]

      counts = Agents.unread_counts(agents)
      assert Map.get(counts, agent.id) == 0
      assert Map.get(counts, agent2.id) == 0
    end

    test "unread_counts/2 counts only agent role messages", %{
      project: project,
      agent: agent
    } do
      # User message — should not count
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "user",
          content: %{"text" => "hello"}
        })

      # Tool use — should not count
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "tool_use",
          content: %{"tool" => "read", "tool_use_id" => "t1"}
        })

      # Inter-agent message — should not count
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "inter_agent",
          content: %{"text" => "peer msg", "from_agent" => "other"}
        })

      # Agent message — should count
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "response"}
        })

      agents = [%{id: agent.id, last_read_message_id: nil}]
      counts = Agents.unread_counts(agents)
      assert Map.get(counts, agent.id) == 1
    end

    test "unread_counts/2 returns 0 when last_read is at latest message", %{
      project: project,
      agent: agent
    } do
      {:ok, m1} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "first"}
        })

      {:ok, m2} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "second"}
        })

      # All read
      agents = [%{id: agent.id, last_read_message_id: m2.id}]
      counts = Agents.unread_counts(agents)
      assert Map.get(counts, agent.id) == 0

      # Only first read
      agents = [%{id: agent.id, last_read_message_id: m1.id}]
      counts = Agents.unread_counts(agents)
      assert Map.get(counts, agent.id) == 1
    end

    test "latest_message_id/1 returns nil when no messages exist", %{agent: agent} do
      assert Agents.latest_message_id(agent.id) == nil
    end

    test "latest_message_id/1 returns the latest agent-role message id", %{
      project: project,
      agent: agent
    } do
      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "user",
          content: %{"text" => "hello"}
        })

      {:ok, m1} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "first"}
        })

      assert Agents.latest_message_id(agent.id) == m1.id

      {:ok, m2} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: agent.id,
          role: "agent",
          content: %{"text" => "second"}
        })

      assert Agents.latest_message_id(agent.id) == m2.id
    end

    test "delete_agent_with_vm/3 deletes agent and its messages", %{project: project} do
      {:ok, del_agent} =
        Agents.create_agent_with_vm(project.id, "delete-test", "version: 1\n", @vm)

      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: del_agent.id,
          role: "user",
          content: %{"text" => "hi"}
        })

      {:ok, other_agent} =
        Agents.create_agent_with_vm(project.id, "other-agent", "version: 1\n", @vm)

      {:ok, _} =
        Agents.create_message(%{
          project_id: project.id,
          agent_id: other_agent.id,
          role: "user",
          content: %{"text" => "keep me"}
        })

      :ok = Agents.delete_agent_with_vm(project.id, del_agent, @vm)

      assert {:error, :not_found} = Agents.get_agent(del_agent.id)

      {other_msgs, _} = Agents.list_messages_for_agent(project.id, other_agent.id)
      assert length(other_msgs) == 1
    end
  end
end
