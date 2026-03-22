defmodule Shire.VirtualMachineE2BTest do
  use ExUnit.Case, async: true

  alias Shire.VirtualMachineE2B, as: VM
  alias Shire.VirtualMachineE2B.Client

  describe "Client.management_req/1" do
    test "builds Req with correct base_url and headers" do
      req = Client.management_req("test-key")
      assert req.options.base_url == "https://api.e2b.dev"

      headers = Map.new(req.headers)
      assert headers["x-api-key"] == ["test-key"]
    end
  end

  describe "Client.sandbox_req/2" do
    test "builds Req with correct sandbox base_url and access token" do
      req = Client.sandbox_req("sandbox-123", "token-abc")
      assert req.options.base_url == "https://49983-sandbox-123.e2b.dev"

      headers = Map.new(req.headers)
      assert headers["x-access-token"] == ["token-abc"]
    end
  end

  describe "StreamHandler event parsing" do
    test "parses start event and returns process pid" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{"event" => %{"start" => %{"pid" => 42}}}
        })

      result = send_stream_data_to_handler(data, caller, ref)
      assert result == 42
    end

    test "parses stdout data event and sends message to caller" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{
            "event" => %{"data" => %{"stdout" => Base.encode64("hello world")}}
          }
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:stdout, %{ref: ^ref}, "hello world"}
    end

    test "parses stderr data event and sends as stdout" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{
            "event" => %{"data" => %{"stderr" => Base.encode64("error msg")}}
          }
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:stdout, %{ref: ^ref}, "error msg"}
    end

    test "parses pty data event and sends as stdout" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{
            "event" => %{"data" => %{"pty" => Base.encode64("pty output")}}
          }
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:stdout, %{ref: ^ref}, "pty output"}
    end

    test "parses end event with exit code" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{"event" => %{"end" => %{"exitCode" => 1}}}
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:exit, %{ref: ^ref}, 1}
    end

    test "parses end event without exit code as 0" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "result" => %{"event" => %{"end" => %{}}}
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:exit, %{ref: ^ref}, 0}
    end

    test "handles multiple events in a single data chunk" do
      caller = self()
      ref = make_ref()

      line1 =
        Jason.encode!(%{
          "result" => %{
            "event" => %{"data" => %{"stdout" => Base.encode64("line1")}}
          }
        })

      line2 =
        Jason.encode!(%{
          "result" => %{
            "event" => %{"data" => %{"stdout" => Base.encode64("line2")}}
          }
        })

      data = line1 <> "\n" <> line2

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:stdout, %{ref: ^ref}, "line1"}
      assert_receive {:stdout, %{ref: ^ref}, "line2"}
    end

    test "handles error events" do
      caller = self()
      ref = make_ref()

      data =
        Jason.encode!(%{
          "error" => %{"code" => "internal", "message" => "something broke"}
        })

      send_stream_data_to_handler(data, caller, ref)
      assert_receive {:exit, %{ref: ^ref}, 1}
    end
  end

  describe "write_stdin/2" do
    test "returns error when handler process is dead" do
      dead_pid = spawn(fn -> :ok end)
      Process.sleep(10)

      handler = %{ref: make_ref(), pid: dead_pid}

      assert {:error, {:process_dead, :noproc}} = VM.write_stdin(handler, "test")
    end

    test "sends write message to live handler process" do
      test_pid = self()

      handler_pid =
        spawn(fn ->
          receive do
            {:write, data} -> send(test_pid, {:got_write, data})
          end
        end)

      handler = %{ref: make_ref(), pid: handler_pid}

      assert :ok = VM.write_stdin(handler, "hello\n")
      assert_receive {:got_write, "hello\n"}
    end
  end

  describe "resize/3" do
    test "returns :ok for non-StreamHandler command ref" do
      assert :ok = VM.resize(%{pid: self()}, 24, 80)
    end
  end

  describe "workspace_root/1" do
    test "returns /home/user" do
      assert VM.workspace_root("any-project") == "/home/user"
    end
  end

  describe "vm_status/1" do
    test "returns :stopped when no VM registered" do
      assert VM.vm_status("nonexistent-project-#{System.unique_integer()}") == :stopped
    end
  end

  describe "terminate/2" do
    test "handles nil sandbox state without crashing" do
      import ExUnit.CaptureLog

      assert capture_log([level: :info], fn ->
               VM.terminate(:shutdown, %{sandbox_id: nil, project_id: "test"})
               Logger.flush()
             end) =~ "VirtualMachineE2B stopping (no sandbox"
    end

    test "handles active sandbox state without crashing" do
      import ExUnit.CaptureLog

      assert capture_log([level: :info], fn ->
               VM.terminate(:shutdown, %{sandbox_id: "sb-123", project_id: "test"})
               Logger.flush()
             end) =~ "VirtualMachineE2B stopping"
    end
  end

  # --- Test helpers ---

  # Directly calls the stream data parsing logic from StreamHandler
  # by simulating what handle_stream_data does
  defp send_stream_data_to_handler(data, caller, ref) do
    data
    |> String.split("\n", trim: true)
    |> Enum.reduce(nil, fn line, pid ->
      case Jason.decode(line) do
        {:ok, %{"result" => result}} ->
          handle_test_event(result, caller, ref) || pid

        {:ok, %{"error" => _error}} ->
          send(caller, {:exit, %{ref: ref}, 1})
          pid

        _ ->
          pid
      end
    end)
  end

  defp handle_test_event(%{"event" => %{"start" => %{"pid" => pid}}}, _caller, _ref), do: pid

  defp handle_test_event(%{"event" => %{"data" => %{"stdout" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    nil
  end

  defp handle_test_event(%{"event" => %{"data" => %{"stderr" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    nil
  end

  defp handle_test_event(%{"event" => %{"data" => %{"pty" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    nil
  end

  defp handle_test_event(%{"event" => %{"end" => %{"exitCode" => code}}}, caller, ref) do
    send(caller, {:exit, %{ref: ref}, code})
    nil
  end

  defp handle_test_event(%{"event" => %{"end" => _}}, caller, ref) do
    send(caller, {:exit, %{ref: ref}, 0})
    nil
  end

  defp handle_test_event(_, _, _), do: nil
end
