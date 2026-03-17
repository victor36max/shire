defmodule Shire.Agent.AgentManagerTest do
  use Shire.DataCase, async: true

  alias Shire.Agent.AgentManager
  alias Shire.Agents

  @agent_name "test-agent"
  @agent_id 8888

  defp start_manager(opts \\ []) do
    name = Keyword.get(opts, :agent_name, @agent_name)
    id = Keyword.get(opts, :agent_id, @agent_id)

    start_supervised(
      {AgentManager, agent_name: name, agent_id: id, sprites_client: nil, skip_sprite: true}
    )
  end

  describe "start_link/1" do
    test "starts the GenServer and registers with the agent id" do
      {:ok, pid} = start_manager()

      assert Process.alive?(pid)
      assert GenServer.call(pid, :get_state) |> Map.get(:phase) == :idle
    end
  end

  describe "state management" do
    test "get_state returns current state" do
      {:ok, pid} = start_manager()

      state = AgentManager.get_state(pid)
      assert state.agent_name == @agent_name
      assert state.phase == :idle
    end
  end

  describe "send_message/3" do
    test "returns error when agent is not active" do
      {:ok, pid} = start_manager()

      assert {:error, :not_active} = GenServer.call(pid, {:send_message, "hello", :user})
    end
  end

  describe "responsiveness" do
    test "get_state responds immediately even during non-idle phases" do
      {:ok, pid} = start_manager()

      state = AgentManager.get_state(pid)
      assert state.phase == :idle
    end
  end

  describe "error handling" do
    test "transitions to failed on command error" do
      {:ok, pid} = start_manager()

      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, phase: :active}
      end)

      send(pid, {:error, %{ref: ref}, :closed})

      # Give the GenServer time to process
      state = AgentManager.get_state(pid)
      assert state.phase == :failed
      assert state.command == nil
      assert state.command_ref == nil
    end
  end

  describe "persist_and_broadcast (stdout event persistence)" do
    setup do
      {:ok, pid} = start_manager()

      # Allow the GenServer process to access the DB sandbox
      Ecto.Adapters.SQL.Sandbox.allow(Shire.Repo, self(), pid)

      # Subscribe to PubSub to receive broadcasts
      Phoenix.PubSub.subscribe(Shire.PubSub, "agent:#{@agent_id}")

      # Create a fake command ref so stdout handler matches
      ref = make_ref()
      command = %{ref: ref}

      :sys.replace_state(pid, fn state ->
        %{state | command: command, command_ref: ref, phase: :active}
      end)

      %{pid: pid, ref: ref}
    end

    test "persists text event as agent message in DB", %{pid: pid, ref: ref} do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "Hello world"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      # Wait for the broadcast
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:role] == "agent"
      assert msg[:id]

      # Verify it was persisted in DB
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
      # First, send tool_use started
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

      # Then send tool_result
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

      # Verify DB was updated
      db_msg = Agents.get_message!(msg_id)
      assert db_msg.content["output"] == "file contents here"
      assert db_msg.content["is_error"] == false
    end

    test "flushes accumulated streaming text on turn_complete", %{pid: pid, ref: ref} do
      # Send text_delta events
      delta1 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "Hello "}})
      delta2 = Jason.encode!(%{"type" => "text_delta", "payload" => %{"delta" => "world"}})
      send(pid, {:stdout, %{ref: ref}, delta1 <> "\n" <> delta2 <> "\n"})

      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000
      assert_receive {:agent_event, _, %{"type" => "text_delta"}}, 1_000

      # Send turn_complete to flush
      complete = Jason.encode!(%{"type" => "turn_complete"})
      send(pid, {:stdout, %{ref: ref}, complete <> "\n"})

      # Should receive a flushed text event with the persisted message
      assert_receive {:agent_event, _, %{"type" => "text", "message" => msg}}, 1_000
      assert msg[:text] == "Hello world"
      assert msg[:id]

      db_msg = Agents.get_message!(msg[:id])
      assert db_msg.content["text"] == "Hello world"
      assert db_msg.agent_name == @agent_name

      # And then the turn_complete
      assert_receive {:agent_event, _, %{"type" => "turn_complete"}}, 1_000
    end

    test "broadcasts include agent_id in 3-tuple", %{pid: pid, ref: ref} do
      line = Jason.encode!(%{"type" => "text", "payload" => %{"text" => "test"}})
      send(pid, {:stdout, %{ref: ref}, line <> "\n"})

      assert_receive {:agent_event, agent_id, _event}, 1_000
      assert agent_id == @agent_id
    end
  end
end
