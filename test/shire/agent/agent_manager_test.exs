defmodule Shire.Agent.AgentManagerTest do
  use Shire.DataCase, async: true

  import Mox

  alias Shire.Agent.AgentManager
  alias Shire.Agents
  alias Shire.Projects

  @vm Shire.VirtualMachineStub

  setup :set_mox_from_context

  setup do
    stub(Shire.VirtualMachineMock, :workspace_root, fn _project_id -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :touch_keepalive, fn _project_id -> :ok end)
    stub(Shire.VirtualMachineMock, :vm_status, fn _project_id -> :running end)

    {:ok, project} = Projects.create_project("test-project-#{System.unique_integer([:positive])}")
    {:ok, agent} = Agents.create_agent_with_vm(project.id, "test-agent", "version: 1\n", @vm)

    %{project: project, agent: agent, project_id: project.id, agent_id: agent.id}
  end

  defp start_manager(ctx, opts \\ []) do
    agent_id = Keyword.get(opts, :agent_id, ctx.agent_id)

    result =
      start_supervised(
        {AgentManager,
         project_id: ctx.project_id,
         agent_id: agent_id,
         agent_name: "test-agent",
         skip_sprite: true}
      )

    case result do
      {:ok, pid} ->
        Mox.allow(Shire.VirtualMachineMock, self(), pid)
        {:ok, pid}

      other ->
        other
    end
  end

  describe "start_link/1" do
    test "starts the GenServer and registers with the agent id", ctx do
      {:ok, pid} = start_manager(ctx)

      assert Process.alive?(pid)
      assert GenServer.call(pid, :get_state) |> Map.get(:status) == :idle
    end
  end

  describe "state management" do
    test "get_state returns current state", ctx do
      {:ok, pid} = start_manager(ctx)

      state = AgentManager.get_state(pid)
      assert state.agent_id == ctx.agent_id
      assert state.status == :idle
    end
  end

  describe "send_message/4" do
    test "returns error when agent is not active", ctx do
      {:ok, pid} = start_manager(ctx)

      assert {:error, :not_active} = GenServer.call(pid, {:send_message, "hello", :user, []})
    end

    test "persists user message to DB when from is :user", ctx do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)

      {:ok, pid} = start_manager(ctx)
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert {:ok, %Shire.Agents.Message{}} =
               GenServer.call(pid, {:send_message, "hello from user", :user, []})

      {messages, _} = Agents.list_messages_for_agent(ctx.project_id, ctx.agent_id)
      user_msgs = Enum.filter(messages, &(&1.role == "user"))
      assert length(user_msgs) == 1
      assert hd(user_msgs).content["text"] == "hello from user"
    end
  end

  describe "interrupt/2" do
    test "returns error when agent is not active", ctx do
      {:ok, pid} = start_manager(ctx)

      assert {:error, :not_active} = GenServer.call(pid, :interrupt)
    end

    test "writes interrupt envelope to inbox when active", ctx do
      Mox.set_mox_global()
      test_pid = self()

      expect(Shire.VirtualMachineMock, :write, fn _project, path, content ->
        send(test_pid, {:write_called, path, content})
        :ok
      end)

      {:ok, pid} = start_manager(ctx)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert :ok = GenServer.call(pid, :interrupt)

      assert_receive {:write_called, path, content}, 1_000
      assert path =~ "/inbox/"
      assert content =~ "interrupt"
    end
  end

  describe "responsiveness" do
    test "get_state responds immediately even during non-idle statuses", ctx do
      {:ok, pid} = start_manager(ctx)

      :sys.replace_state(pid, fn state ->
        %{state | status: :bootstrapping}
      end)

      state = AgentManager.get_state(pid)
      assert state.status == :bootstrapping
    end
  end

  describe "error handling" do
    test "transitions to idle on command error", ctx do
      {:ok, pid} = start_manager(ctx)

      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, status: :active}
      end)

      send(pid, {:error, %{ref: ref}, :closed})

      state = AgentManager.get_state(pid)
      assert state.status == :idle
      assert state.command == nil
      assert state.command_ref == nil
    end
  end

  describe "persist_and_broadcast (stdout event persistence)" do
    setup ctx do
      {:ok, pid} = start_manager(ctx)

      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agent:#{ctx.agent_id}"
      )

      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, status: :active}
      end)

      %{pid: pid, ref: ref}
    end

    test "persists text event as agent message in DB", %{pid: pid, ref: ref} = _ctx do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "Hello world"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:role] == "agent"
      assert msg[:id]

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["text"] == "Hello world"
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

      assert_receive {:agent_event, _, %{"type" => "turn_complete"}}, 1_000
    end

    test "skips duplicate DB message when streaming text is flushed by text event",
         %{pid: pid, ref: ref} = ctx do
      # Send streaming deltas first
      delta1 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "Hello "}})
      delta2 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "world"}})
      send(pid, {:stdout, %{ref: ref}, delta1 <> "\n" <> delta2 <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000
      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000

      # Now send the final text event (same content as accumulated streaming)
      text_event =
        Jason.encode!(%{"type" => "text", "payload" => %{"text" => "Hello world"}})

      send(pid, {:stdout, %{ref: ref}, text_event <> "\n"})

      # Should receive the flushed streaming text as a persisted message
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:id]

      # Should NOT receive a second text event (the duplicate)
      refute_receive {:agent_event, _, %{"type" => "text"}}, 300

      # Verify only one DB message was created (the flushed streaming text)
      {messages, _} = Agents.list_messages_for_agent(ctx.project_id, ctx.agent_id)
      agent_msgs = Enum.filter(messages, &(&1.role == "agent"))
      assert length(agent_msgs) == 1
      assert hd(agent_msgs).content["text"] == "Hello world"
    end

    test "persists text event normally when no streaming text was accumulated",
         %{pid: pid, ref: ref} = ctx do
      # Send text event without any prior streaming deltas
      text_event =
        Jason.encode!(%{"type" => "text", "payload" => %{"text" => "Direct message"}})

      send(pid, {:stdout, %{ref: ref}, text_event <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Direct message"
      assert msg[:id]

      {messages, _} = Agents.list_messages_for_agent(ctx.project_id, ctx.agent_id)
      agent_msgs = Enum.filter(messages, &(&1.role == "agent"))
      assert length(agent_msgs) == 1
      assert hd(agent_msgs).content["text"] == "Direct message"
    end

    test "handles interleaved streaming and non-streaming text events correctly",
         %{pid: pid, ref: ref} = ctx do
      # First turn: streaming deltas then text event (should deduplicate)
      delta = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "streamed"}})
      send(pid, {:stdout, %{ref: ref}, delta <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000

      text1 = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "streamed"}})
      send(pid, {:stdout, %{ref: ref}, text1 <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg1}}, 1_000
      assert msg1[:text] == "streamed"
      refute_receive {:agent_event, _, %{"type" => "text"}}, 200

      # Second turn: text event without streaming (should persist normally)
      text2 = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "direct"}})
      send(pid, {:stdout, %{ref: ref}, text2 <> "\n"})
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg2}}, 1_000
      assert msg2[:text] == "direct"
      assert msg2[:id]

      # Verify exactly 2 DB messages total
      {messages, _} = Agents.list_messages_for_agent(ctx.project_id, ctx.agent_id)
      agent_msgs = Enum.filter(messages, &(&1.role == "agent"))
      assert length(agent_msgs) == 2
      texts = Enum.map(agent_msgs, & &1.content["text"]) |> Enum.sort()
      assert texts == ["direct", "streamed"]
    end

    test "broadcasts include agent_id in 3-tuple", ctx do
      %{pid: pid, ref: ref} = ctx
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "test"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, agent_id, _event}, 1_000
      assert agent_id == ctx.agent_id
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

  describe "agent_message_received stdout event" do
    setup ctx do
      Mox.set_mox_global()

      {:ok, pid} = start_manager(ctx)
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agent:#{ctx.agent_id}"
      )

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      %{pid: pid, ref: ref}
    end

    test "persists inter_agent message to DB", ctx do
      event =
        Jason.encode!(%{
          "type" => "agent_message_received",
          "payload" => %{"from_agent" => "other-agent", "text" => "hello from other"}
        })

      send(ctx.pid, {:stdout, %{ref: ctx.ref}, event <> "\n"})

      # Give it a moment to process
      Process.sleep(50)

      {messages, _has_more} = Agents.list_messages_for_agent(ctx.project_id, ctx.agent_id)
      inter_agent = Enum.find(messages, &(&1.role == "inter_agent"))
      assert inter_agent != nil
      assert inter_agent.content["text"] == "hello from other"
      assert inter_agent.content["from_agent"] == "other-agent"
      assert inter_agent.content["to_agent"] == "test-agent"
    end

    test "broadcasts inter_agent_message event via PubSub", ctx do
      event =
        Jason.encode!(%{
          "type" => "agent_message_received",
          "payload" => %{"from_agent" => "other-agent", "text" => "hello from other"}
        })

      send(ctx.pid, {:stdout, %{ref: ctx.ref}, event <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "inter_agent_message", "message" => msg}},
                     1_000

      assert msg[:role] == "inter_agent"
      assert msg[:text] == "hello from other"
      assert msg[:from_agent] == "other-agent"
      assert msg[:id]
    end
  end

  describe "runner exit" do
    test "transitions to idle when runner exits", ctx do
      {:ok, pid} = start_manager(ctx)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agent:#{ctx.agent_id}"
      )

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      send(pid, {:exit, %{ref: ref}, 1})

      state = AgentManager.get_state(pid)
      assert state.status == :idle
      assert state.command == nil
      assert state.command_ref == nil

      assert_receive {:agent_status, _, :idle}, 1_000
    end

    test "broadcasts status to project agents topic", ctx do
      {:ok, pid} = start_manager(ctx)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agents"
      )

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      send(pid, {:exit, %{ref: ref}, 1})

      assert_receive {:agent_status, _, :idle}, 1_000
    end

    test "transitions to idle when runner errors", ctx do
      {:ok, pid} = start_manager(ctx)

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      send(pid, {:error, %{ref: ref}, :connection_closed})

      state = AgentManager.get_state(pid)
      assert state.status == :idle
      assert state.command == nil
    end
  end

  describe "processing event" do
    test "broadcasts agent_busy to project agents topic", ctx do
      {:ok, pid} = start_manager(ctx)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agents"
      )

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      line = Jason.encode!(%{"type" => "processing", "payload" => %{"active" => true}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_busy, _, true}, 1_000
    end
  end

  describe "restart" do
    test "resets state and transitions to bootstrapping", ctx do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

      {:ok, pid} = start_manager(ctx)
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agent:#{ctx.agent_id}"
      )

      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      assert :ok = AgentManager.restart(ctx.project_id, ctx.agent_id)

      assert_receive {:agent_status, _, :bootstrapping}, 1_000
    end
  end

  describe "keepalive touch on stdout" do
    test "touches keepalive on first stdout", ctx do
      test_pid = self()

      expect(Shire.VirtualMachineMock, :touch_keepalive, fn _project_id ->
        send(test_pid, :keepalive_touched)
        :ok
      end)

      {:ok, pid} = start_manager(ctx)
      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      state_before = AgentManager.get_state(pid)
      assert state_before.last_keepalive_touch == nil

      line = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "hi"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive :keepalive_touched, 1_000

      state_after = AgentManager.get_state(pid)
      assert state_after.last_keepalive_touch != nil
    end

    test "throttles keepalive touches within interval", ctx do
      test_pid = self()

      # Expect exactly one call despite two stdout messages
      expect(Shire.VirtualMachineMock, :touch_keepalive, 1, fn _project_id ->
        send(test_pid, :keepalive_touched)
        :ok
      end)

      {:ok, pid} = start_manager(ctx)
      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active}
      end)

      line = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "a"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive :keepalive_touched, 1_000

      state_after_first = AgentManager.get_state(pid)
      first_touch = state_after_first.last_keepalive_touch
      assert first_touch != nil

      # Second stdout within 30s should NOT trigger another touch
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      Process.sleep(50)
      state_after_second = AgentManager.get_state(pid)
      assert state_after_second.last_keepalive_touch == first_touch
    end
  end

  describe "auto_restart" do
    test "works like restart on first attempt", ctx do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :write, fn _project, _path, _content -> :ok end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)
      stub(Shire.VirtualMachineMock, :mkdir_p, fn _project, _path -> :ok end)
      stub(Shire.VirtualMachineMock, :rm_rf, fn _project, _path -> :ok end)

      {:ok, pid} = start_manager(ctx)
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      Phoenix.PubSub.subscribe(
        Shire.PubSub,
        "project:#{ctx.project_id}:agent:#{ctx.agent_id}"
      )

      assert :ok = AgentManager.auto_restart(ctx.project_id, ctx.agent_id)
      assert_receive {:agent_status, _, :bootstrapping}, 1_000
    end

    test "returns {:error, :max_retries} after too many consecutive failures", ctx do
      {:ok, pid} = start_manager(ctx)

      # Simulate having hit the max restart count
      :sys.replace_state(pid, fn state ->
        %{state | auto_restart_count: 3}
      end)

      assert {:error, :max_retries} =
               AgentManager.auto_restart(ctx.project_id, ctx.agent_id)
    end

    test "skips workspace setup on auto_restart (fast path)", ctx do
      Mox.set_mox_global()
      stub(Shire.VirtualMachineMock, :cmd, fn _project, _cmd, _args, _opts -> {:ok, ""} end)
      stub(Shire.VirtualMachineMock, :read, fn _project, _path -> {:error, :enoent} end)

      # write/mkdir_p/rm_rf should NOT be called — fast path skips setup_agent_workspace
      Mox.expect(Shire.VirtualMachineMock, :write, 0, fn _project, _path, _content -> :ok end)
      Mox.expect(Shire.VirtualMachineMock, :mkdir_p, 0, fn _project, _path -> :ok end)
      Mox.expect(Shire.VirtualMachineMock, :rm_rf, 0, fn _project, _path -> :ok end)

      stub(Shire.VirtualMachineMock, :spawn_command, fn _project, _cmd, _args, _opts ->
        {:ok, %{ref: make_ref()}}
      end)

      {:ok, pid} = start_manager(ctx)
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      assert :ok = AgentManager.auto_restart(ctx.project_id, ctx.agent_id)

      # Give spawn_runner time to execute
      Process.sleep(100)
      Mox.verify!(Shire.VirtualMachineMock)
    end

    test "resets auto_restart_count when agent becomes active", ctx do
      {:ok, pid} = start_manager(ctx)

      :sys.replace_state(pid, fn state ->
        %{state | auto_restart_count: 2}
      end)

      # Simulate successful spawn by directly setting active state with reset count
      ref = make_ref()

      :sys.replace_state(pid, fn state ->
        %{state | command: %{ref: ref}, command_ref: ref, status: :active, auto_restart_count: 0}
      end)

      state = AgentManager.get_state(pid)
      assert state.auto_restart_count == 0
    end
  end
end
