defmodule Shire.Agent.AgentManagerTest do
  use Shire.DataCase, async: true

  import Mox

  alias Shire.Agent.AgentManager
  alias Shire.Agents

  @agent_name "test-agent"

  setup :set_mox_from_context

  defp start_manager(opts \\ []) do
    name = Keyword.get(opts, :agent_name, @agent_name)

    start_supervised({AgentManager, agent_name: name, skip_sprite: true})
  end

  describe "start_link/1" do
    test "starts the GenServer and registers with the agent name" do
      {:ok, pid} = start_manager()

      assert Process.alive?(pid)
      assert GenServer.call(pid, :get_state) |> Map.get(:status) == :idle
    end
  end

  describe "state management" do
    test "get_state returns current state" do
      {:ok, pid} = start_manager()

      state = AgentManager.get_state(pid)
      assert state.agent_name == @agent_name
      assert state.status == :idle
    end
  end

  describe "send_message/3" do
    test "returns error when agent is not active" do
      {:ok, pid} = start_manager()

      assert {:error, :not_active} = GenServer.call(pid, {:send_message, "hello", :user})
    end

    test "persists user message to DB when from is :user" do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert {:ok, %Shire.Agents.Message{}} = GenServer.call(pid, {:send_message, "hello from user", :user})

      {messages, _} = Agents.list_messages_for_agent(@agent_name)
      user_msgs = Enum.filter(messages, &(&1.role == "user"))
      assert length(user_msgs) == 1
      assert hd(user_msgs).content["text"] == "hello from user"
    end
  end

  describe "responsiveness" do
    test "get_state responds immediately even during non-idle statuses" do
      {:ok, pid} = start_manager()

      :sys.replace_state(pid, fn state ->
        %{state | status: :bootstrapping}
      end)

      state = AgentManager.get_state(pid)
      assert state.status == :bootstrapping
    end
  end

  describe "error handling" do
    test "transitions to failed on command error" do
      {:ok, pid} = start_manager()

      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, status: :active}
      end)

      send(pid, {:error, %{ref: ref}, :closed})

      state = AgentManager.get_state(pid)
      assert state.status == :failed
      assert state.command == nil
      assert state.command_ref == nil
    end
  end

  describe "persist_and_broadcast (stdout event persistence)" do
    setup do
      {:ok, pid} = start_manager()

      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_name}")

      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, status: :active}
      end)

      %{pid: pid, ref: ref}
    end

    test "persists text event as agent message in DB", %{pid: pid, ref: ref} do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "Hello world"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:role] == "agent"
      assert msg[:id]

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["text"] == "Hello world"
      assert db_msg.agent_name == @agent_name
    end

    test "persists tool_use started event in DB", %{pid: pid, ref: ref} do
      line =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "started",
            "tool" => "Read",
            "tool_use_id" => "tu_abc",
            "input" => %{"path" => "/foo"}
          }
        })

      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "tool_use", "message" => msg}}, 1_000
      assert msg[:tool] == "Read"
      assert msg[:tool_use_id] == "tu_abc"
      assert msg[:id]

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.role == "tool_use"
      assert db_msg.content["tool"] == "Read"
      assert db_msg.agent_name == @agent_name
    end

    test "updates tool_use with tool_result in DB", %{pid: pid, ref: ref} do
      started =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "started",
            "tool" => "Read",
            "tool_use_id" => "tu_xyz",
            "input" => %{}
          }
        })

      send(pid, {:stdout, %{ref: ref}, started <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_use", "message" => msg}}, 1_000
      msg_id = msg[:id]

      result =
        Jason.encode!(%{
          "type" => "tool_result",
          "payload" => %{
            "tool_use_id" => "tu_xyz",
            "output" => "file contents here",
            "is_error" => false
          }
        })

      send(pid, {:stdout, %{ref: ref}, result <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_result"}}, 1_000

      db_msg = Agents.get_message!(msg_id)
      assert db_msg.content["output"] == "file contents here"
      assert db_msg.content["is_error"] == false
    end

    test "flushes accumulated streaming text on turn_complete", %{pid: pid, ref: ref} do
      delta1 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "Hello "}})
      delta2 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "world"}})
      send(pid, {:stdout, %{ref: ref}, delta1 <> "\n" <> delta2 <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000
      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000

      complete = Jason.encode!(%{"type" => "turn_complete"})
      send(pid, {:stdout, %{ref: ref}, complete <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:id]

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["text"] == "Hello world"
      assert db_msg.agent_name == @agent_name

      assert_receive {:agent_event, _, %{"type" => "turn_complete"}}, 1_000
    end

    test "broadcasts include agent_name in 3-tuple", %{pid: pid, ref: ref} do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "test"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, agent_name, _event}, 1_000
      assert agent_name == @agent_name
    end

    test "cleans up tool_use_ids after tool_result", %{pid: pid, ref: ref} do
      started =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "started",
            "tool" => "Read",
            "tool_use_id" => "tu_cleanup",
            "input" => %{}
          }
        })

      send(pid, {:stdout, %{ref: ref}, started <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_use"}}, 1_000

      result =
        Jason.encode!(%{
          "type" => "tool_result",
          "payload" => %{
            "tool_use_id" => "tu_cleanup",
            "output" => "done",
            "is_error" => false
          }
        })

      send(pid, {:stdout, %{ref: ref}, result <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_result"}}, 1_000

      state = AgentManager.get_state(pid)
      assert state.tool_use_ids == %{}
    end

    test "handles partial JSONL buffering across stdout chunks", %{pid: pid, ref: ref} do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "buffered"}})
      {first_half, second_half} = String.split_at(line, div(String.length(line), 2))

      send(pid, {:stdout, %{ref: ref}, first_half})
      refute_receive {:agent_event, _, _}, 100

      send(pid, {:stdout, %{ref: ref}, second_half <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "buffered"
    end

    test "ignores unparseable stdout lines", %{pid: pid, ref: ref} do
      send(pid, {:stdout, %{ref: ref}, "not valid json\n"})

      refute_receive {:agent_event, _, _}, 200
    end

    test "persists input_ready tool_use when no prior started event", %{pid: pid, ref: ref} do
      line =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "input_ready",
            "tool" => "Write",
            "tool_use_id" => "tu_input",
            "input" => %{"path" => "/bar"}
          }
        })

      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "tool_use", "message" => msg}}, 1_000
      assert msg[:tool] == "Write"
      assert msg[:tool_use_id] == "tu_input"

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["input"] == %{"path" => "/bar"}
    end

    test "updates existing tool_use on input_ready", %{pid: pid, ref: ref} do
      started =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "started",
            "tool" => "Edit",
            "tool_use_id" => "tu_update",
            "input" => %{}
          }
        })

      send(pid, {:stdout, %{ref: ref}, started <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_use", "message" => msg}}, 1_000

      input_ready =
        Jason.encode!(%{
          "type" => "tool_use",
          "payload" => %{
            "status" => "input_ready",
            "tool" => "Edit",
            "tool_use_id" => "tu_update",
            "input" => %{"file" => "/baz"}
          }
        })

      send(pid, {:stdout, %{ref: ref}, input_ready <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "tool_use"}}, 1_000

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["input"] == %{"file" => "/baz"}
    end
  end

  describe "send_message with agent from" do
    test "writes agent message envelope to inbox and persists" do
      Mox.set_mox_global()
      test_pid = self()

      stub(Shire.VirtualMachineMock, :write, fn path, content ->
        send(test_pid, {:vm_write, path, content})
        :ok
      end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert :ok = GenServer.call(pid, {:send_message, "hello", {:agent, "other-agent"}})

      assert_receive {:vm_write, path, content}, 1_000
      assert path =~ "/workspace/agents/#{@agent_name}/inbox/"
      decoded = Jason.decode!(content)
      assert decoded["type"] == "agent_message"
      assert decoded["from"] == "other-agent"
      assert decoded["payload"]["text"] == "hello"
    end
  end

  describe "runner exit" do
    test "transitions to failed when runner exits" do
      {:ok, pid} = start_manager()

      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_name}")

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      send(pid, {:exit, %{ref: ref}, 1})

      state = AgentManager.get_state(pid)
      assert state.status == :failed
      assert state.command == nil
      assert state.command_ref == nil

      assert_receive {:status, :failed}, 1_000
    end
  end

  describe "restart" do
    test "resets state and transitions to bootstrapping" do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :cmd, fn _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_name}")

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert :ok = AgentManager.restart(@agent_name)

      assert_receive {:status, :bootstrapping}, 1_000
    end
  end

  describe "outbox polling" do
    test "polls outbox and delivers agent messages when active" do
      Mox.set_mox_global()
      test_pid = self()

      stub(Shire.VirtualMachineMock, :ls, fn path ->
        if String.ends_with?(path, "/outbox") do
          {:ok, [%{"name" => "1234.json"}]}
        else
          {:ok, []}
        end
      end)

      stub(Shire.VirtualMachineMock, :read, fn _path ->
        {:ok, Jason.encode!(%{"to" => "target-agent", "text" => "hello from outbox"})}
      end)

      stub(Shire.VirtualMachineMock, :rm, fn path ->
        send(test_pid, {:vm_rm, path})
        :ok
      end)

      stub(Shire.VirtualMachineMock, :write, fn path, content ->
        send(test_pid, {:vm_write, path, content})
        :ok
      end)

      # Start target agent so send_message can reach it
      {:ok, target_pid} =
        AgentManager.start_link(agent_name: "target-agent", skip_sprite: true)

      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), target_pid)

      target_ref = make_ref()

      :sys.replace_state(target_pid, fn state ->
        %{state | command: %{ref: target_ref}, command_ref: target_ref, status: :active}
      end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state |
          command: %{ref: ref},
          command_ref: ref,
          status: :active,
          last_activity: System.monotonic_time(:millisecond)
        }
      end)

      send(pid, :poll_outbox)

      # Message delivered to target agent via send_message
      assert_receive {:vm_write, path, content}, 2_000
      assert path =~ "/workspace/agents/target-agent/inbox/"
      decoded = Jason.decode!(content)
      assert decoded["type"] == "agent_message"
      assert decoded["from"] == @agent_name
      assert decoded["payload"]["text"] == "hello from outbox"

      # Outbox file removed after delivery
      assert_receive {:vm_rm, rm_path}, 1_000
      assert rm_path =~ "/outbox/1234.json"
    end

    test "handles shell-escaped JSON in outbox messages" do
      Mox.set_mox_global()
      test_pid = self()

      stub(Shire.VirtualMachineMock, :ls, fn path ->
        if String.ends_with?(path, "/outbox") do
          {:ok, [%{"name" => "1234.json"}]}
        else
          {:ok, []}
        end
      end)

      # Simulate shell adding backslash escapes (e.g. \! from bash history expansion)
      stub(Shire.VirtualMachineMock, :read, fn _path ->
        {:ok, ~s|{"to":"target-agent","text":"Hello\\! How are you\\?"}|}
      end)

      stub(Shire.VirtualMachineMock, :rm, fn _path -> :ok end)

      stub(Shire.VirtualMachineMock, :write, fn path, content ->
        send(test_pid, {:vm_write, path, content})
        :ok
      end)

      # Start target agent
      {:ok, target_pid} =
        AgentManager.start_link(agent_name: "target-agent", skip_sprite: true)

      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), target_pid)

      target_ref = make_ref()

      :sys.replace_state(target_pid, fn state ->
        %{state | command: %{ref: target_ref}, command_ref: target_ref, status: :active}
      end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state |
          command: %{ref: ref},
          command_ref: ref,
          status: :active,
          last_activity: System.monotonic_time(:millisecond)
        }
      end)

      send(pid, :poll_outbox)

      assert_receive {:vm_write, path, content}, 2_000
      assert path =~ "/workspace/agents/target-agent/inbox/"
      decoded = Jason.decode!(content)
      assert decoded["payload"]["text"] == "Hello! How are you?"
    end

    test "handles nil entries from ls gracefully" do
      Mox.set_mox_global()

      stub(Shire.VirtualMachineMock, :ls, fn _path -> {:ok, nil} end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state |
          command: %{ref: ref},
          command_ref: ref,
          status: :active,
          last_activity: System.monotonic_time(:millisecond)
        }
      end)

      send(pid, :poll_outbox)

      # Should not crash — verify process is still alive
      assert Process.alive?(pid)
      state = AgentManager.get_state(pid)
      assert state.status == :active
    end

    test "does not poll when not active" do
      {:ok, pid} = start_manager()

      send(pid, :poll_outbox)

      state = AgentManager.get_state(pid)
      assert state.status == :idle
      assert state.outbox_timer == nil
    end

    test "skips outbox poll when idle" do
      Mox.set_mox_global()
      test_pid = self()

      stub(Shire.VirtualMachineMock, :ls, fn _path ->
        send(test_pid, :ls_called)
        {:ok, []}
      end)

      {:ok, pid} = start_manager()
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state |
          command: %{ref: ref},
          command_ref: ref,
          status: :active,
          last_activity: System.monotonic_time(:millisecond) - 120_000
        }
      end)

      send(pid, :poll_outbox)

      # Give it a moment to process
      Process.sleep(50)
      refute_received :ls_called
    end
  end
end
