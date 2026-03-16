defmodule SpriteAgents.MailboxTest do
  use ExUnit.Case, async: true

  alias SpriteAgents.Mailbox

  describe "encode/3" do
    test "encodes a user_message envelope" do
      envelope =
        Mailbox.encode("user_message", "coordinator", %{text: "hello"}, ts: 1_710_500_000_000)

      decoded = Jason.decode!(envelope)
      assert decoded["ts"] == 1_710_500_000_000
      assert decoded["type"] == "user_message"
      assert decoded["from"] == "coordinator"
      assert decoded["payload"]["text"] == "hello"
    end

    test "encodes an agent_message envelope" do
      envelope =
        Mailbox.encode("agent_message", "alice", %{text: "hi bob"}, ts: 1_710_500_001_000)

      decoded = Jason.decode!(envelope)
      assert decoded["type"] == "agent_message"
      assert decoded["from"] == "alice"
      assert decoded["payload"]["text"] == "hi bob"
    end

    test "auto-generates ts when not provided" do
      envelope = Mailbox.encode("user_message", "coordinator", %{text: "hello"})
      decoded = Jason.decode!(envelope)
      assert is_integer(decoded["ts"])
      assert decoded["ts"] > 0
    end
  end

  describe "decode/1" do
    test "decodes a valid envelope" do
      json =
        Jason.encode!(%{
          ts: 1_710_500_000_000,
          type: "user_message",
          from: "coordinator",
          payload: %{text: "hello"}
        })

      assert {:ok, msg} = Mailbox.decode(json)
      assert msg.type == "user_message"
      assert msg.from == "coordinator"
      assert msg.payload == %{"text" => "hello"}
    end

    test "returns error for invalid JSON" do
      assert {:error, _} = Mailbox.decode("not json")
    end
  end

  describe "filename/1" do
    test "formats filename from timestamp" do
      assert Mailbox.filename(1_710_500_000_000) == "1710500000000.json"
    end
  end

  describe "parse_stdout_line/1" do
    test "parses a valid JSONL event" do
      line = Jason.encode!(%{type: "text_delta", payload: %{delta: "hello"}})
      assert {:ok, event} = Mailbox.parse_stdout_line(line)
      assert event["type"] == "text_delta"
      assert event["payload"]["delta"] == "hello"
    end

    test "returns error for non-JSON line" do
      assert {:error, _} = Mailbox.parse_stdout_line("some random output")
    end

    test "ignores empty lines" do
      assert :ignore = Mailbox.parse_stdout_line("")
      assert :ignore = Mailbox.parse_stdout_line("\n")
    end
  end
end
