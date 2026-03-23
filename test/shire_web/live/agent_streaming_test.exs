defmodule ShireWeb.AgentLive.AgentStreamingTest do
  use Shire.DataCase, async: true

  alias ShireWeb.AgentLive.AgentStreaming

  defp socket_assigns(overrides) do
    defaults = %{
      messages: [],
      streaming_text: nil
    }

    Map.merge(defaults, overrides)
  end

  defp mock_socket(overrides \\ %{}) do
    assigns = socket_assigns(overrides)

    %Phoenix.LiveView.Socket{
      assigns: Map.merge(%{__changed__: %{}}, assigns),
      private: %{live_temp: %{}}
    }
  end

  defp pushed_events(socket) do
    socket.private.live_temp[:push_events] || []
  end

  describe "process_agent_event/2 with text_delta" do
    test "accumulates streaming text in assigns" do
      socket = mock_socket()
      event = %{"type" => "text_delta", "payload" => %{"delta" => "Hello "}}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert socket.assigns.streaming_text == "Hello "

      event2 = %{"type" => "text_delta", "payload" => %{"delta" => "world"}}
      socket = AgentStreaming.process_agent_event(socket, event2)
      assert socket.assigns.streaming_text == "Hello world"
    end

    test "pushes text_delta event to client" do
      socket = mock_socket()
      event = %{"type" => "text_delta", "payload" => %{"delta" => "Hello"}}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert ["text_delta", %{delta: "Hello"}] in pushed_events(socket)
    end

    test "does not modify messages list" do
      socket = mock_socket(%{messages: [%{id: 1, role: "user", text: "hi"}]})
      event = %{"type" => "text_delta", "payload" => %{"delta" => "Hello"}}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert length(socket.assigns.messages) == 1
    end
  end

  describe "process_agent_event/2 with text (persisted by AgentManager)" do
    test "appends message from broadcast and clears streaming" do
      msg = %{id: 1, role: "agent", text: "Hello world", ts: "2024-01-01T00:00:00Z"}
      socket = mock_socket(%{streaming_text: "Hello "})
      event = %{"type" => "text", "payload" => %{"text" => "Hello world"}, "message" => msg}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert socket.assigns.streaming_text == nil
      assert List.last(socket.assigns.messages) == msg
    end

    test "pushes streaming_flush when streaming text was pending" do
      msg = %{id: 1, role: "agent", text: "Hello world", ts: "2024-01-01T00:00:00Z"}
      socket = mock_socket(%{streaming_text: "Hello "})
      event = %{"type" => "text", "payload" => %{"text" => "Hello world"}, "message" => msg}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert ["streaming_flush", %{}] in pushed_events(socket)
    end

    test "does not push streaming_flush when no streaming text was pending" do
      msg = %{id: 1, role: "agent", text: "Hello world", ts: "2024-01-01T00:00:00Z"}
      socket = mock_socket()
      event = %{"type" => "text", "payload" => %{"text" => "Hello world"}, "message" => msg}

      socket = AgentStreaming.process_agent_event(socket, event)
      refute ["streaming_flush", %{}] in pushed_events(socket)
    end
  end

  describe "process_agent_event/2 with tool_use started" do
    test "appends tool_use message from broadcast" do
      msg = %{
        id: 2,
        role: "tool_use",
        tool: "Read",
        tool_use_id: "tu_123",
        input: %{},
        output: nil,
        is_error: false,
        ts: "2024-01-01T00:00:00Z"
      }

      socket = mock_socket()

      event = %{
        "type" => "tool_use",
        "payload" => %{"status" => "started", "tool" => "Read", "tool_use_id" => "tu_123"},
        "message" => msg
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      assert List.last(socket.assigns.messages) == msg
      assert socket.assigns.streaming_text == nil
    end

    test "creates fallback message when no message in broadcast" do
      socket = mock_socket()

      event = %{
        "type" => "tool_use",
        "payload" => %{
          "status" => "started",
          "tool" => "Read",
          "tool_use_id" => "tu_123",
          "input" => %{"path" => "/foo"}
        }
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      tool_msg = List.last(socket.assigns.messages)
      assert tool_msg[:role] == "tool_use"
      assert tool_msg[:tool] == "Read"
      assert tool_msg[:tool_use_id] == "tu_123"
    end

    test "pushes streaming_flush when streaming text was pending" do
      socket = mock_socket(%{streaming_text: "partial"})

      event = %{
        "type" => "tool_use",
        "payload" => %{"status" => "started", "tool" => "Read", "tool_use_id" => "tu_123"},
        "message" => %{id: 2, role: "tool_use", tool: "Read", tool_use_id: "tu_123"}
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      assert ["streaming_flush", %{}] in pushed_events(socket)
    end
  end

  describe "process_agent_event/2 with tool_result" do
    test "updates matching tool_use in message list" do
      existing_msg = %{
        id: 2,
        role: "tool_use",
        tool: "Read",
        tool_use_id: "tu_123",
        input: %{},
        output: nil,
        is_error: false,
        ts: "2024-01-01T00:00:00Z"
      }

      socket = mock_socket(%{messages: [existing_msg]})

      event = %{
        "type" => "tool_result",
        "payload" => %{
          "tool_use_id" => "tu_123",
          "output" => "file contents",
          "is_error" => false
        }
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      updated_msg = List.last(socket.assigns.messages)
      assert updated_msg[:output] == "file contents"
      assert updated_msg[:is_error] == false
    end
  end

  describe "process_agent_event/2 with inter_agent_message" do
    test "appends inter-agent message and clears streaming text" do
      msg = %{
        id: 5,
        role: "inter_agent",
        text: "hello from other",
        from_agent: "other-agent",
        ts: "2024-01-01T00:00:00Z"
      }

      socket = mock_socket(%{streaming_text: "partial"})

      event = %{
        "type" => "inter_agent_message",
        "payload" => %{"from_agent" => "other-agent", "text" => "hello from other"},
        "message" => msg
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      inter_agent = Enum.find(socket.assigns.messages, &(&1[:role] == "inter_agent"))
      assert inter_agent[:text] == "hello from other"
      assert inter_agent[:from_agent] == "other-agent"
      assert socket.assigns.streaming_text == nil
    end
  end

  describe "process_agent_event/2 with attachment" do
    test "appends attachment message and clears streaming text" do
      msg = %{
        id: 10,
        role: "agent",
        text: "",
        attachments: [
          %{
            "id" => "abc123",
            "filename" => "report.csv",
            "size" => 1024,
            "content_type" => "text/csv"
          }
        ],
        ts: "2024-01-01T00:00:00Z"
      }

      socket = mock_socket(%{streaming_text: "partial"})

      event = %{
        "type" => "attachment",
        "payload" => %{
          "id" => "abc123",
          "filename" => "report.csv",
          "size" => 1024,
          "content_type" => "text/csv"
        },
        "message" => msg
      }

      socket = AgentStreaming.process_agent_event(socket, event)
      att_msg = List.last(socket.assigns.messages)
      assert att_msg[:role] == "agent"
      assert length(att_msg[:attachments]) == 1
      assert socket.assigns.streaming_text == nil
    end
  end

  describe "process_agent_event/2 with turn_complete" do
    test "clears streaming text" do
      socket = mock_socket(%{streaming_text: "partial text"})
      event = %{"type" => "turn_complete"}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert socket.assigns.streaming_text == nil
    end

    test "pushes streaming_flush when streaming text was pending" do
      socket = mock_socket(%{streaming_text: "partial text"})
      event = %{"type" => "turn_complete"}

      socket = AgentStreaming.process_agent_event(socket, event)
      assert ["streaming_flush", %{}] in pushed_events(socket)
    end
  end

  describe "display-only (no DB calls)" do
    test "does not create messages in DB for text events" do
      msg = %{id: 999, role: "agent", text: "Hello", ts: "2024-01-01T00:00:00Z"}
      socket = mock_socket()
      event = %{"type" => "text", "payload" => %{"text" => "Hello"}, "message" => msg}

      initial_count = Shire.Repo.aggregate(Shire.Agents.Message, :count)
      AgentStreaming.process_agent_event(socket, event)
      assert Shire.Repo.aggregate(Shire.Agents.Message, :count) == initial_count
    end

    test "does not create messages in DB for tool_use events" do
      msg = %{
        id: 999,
        role: "tool_use",
        tool: "Read",
        tool_use_id: "tu_1",
        input: %{},
        output: nil,
        is_error: false,
        ts: "2024-01-01T00:00:00Z"
      }

      socket = mock_socket()

      event = %{
        "type" => "tool_use",
        "payload" => %{"status" => "started", "tool" => "Read", "tool_use_id" => "tu_1"},
        "message" => msg
      }

      initial_count = Shire.Repo.aggregate(Shire.Agents.Message, :count)
      AgentStreaming.process_agent_event(socket, event)
      assert Shire.Repo.aggregate(Shire.Agents.Message, :count) == initial_count
    end
  end
end
