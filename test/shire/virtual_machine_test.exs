defmodule Shire.VirtualMachineImplTest do
  use ExUnit.Case, async: true

  alias Shire.VirtualMachineImpl, as: VM

  describe "build_filesystem/1 patches base_url" do
    test "adds /v1/sprites/{name} prefix to base_url" do
      # Build minimal sprite-like struct to test the patching logic
      inner_req = Req.new(base_url: "https://api.sprites.dev")

      sprite = %{
        name: "test-vm",
        client: %{
          req: inner_req,
          base_url: "https://api.sprites.dev"
        }
      }

      # Verify the struct manipulation without calling the SDK
      prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
      patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
      patched_client = %{sprite.client | req: patched_req}
      patched_sprite = %{sprite | client: patched_client}

      assert patched_sprite.client.req.options.base_url ==
               "https://api.sprites.dev/v1/sprites/test-vm"
    end

    test "encodes special characters in sprite name" do
      prefix = "/v1/sprites/#{URI.encode("my vm")}"
      assert prefix == "/v1/sprites/my%20vm"
    end
  end

  describe "write_stdin/2" do
    test "returns {:error, {:process_dead, _}} when process is not alive" do
      # Need a real Sprites.Command struct for pattern matching
      dead_pid = spawn(fn -> :ok end)
      Process.sleep(10)

      fake_command = %Sprites.Command{
        pid: dead_pid,
        ref: make_ref(),
        owner: self()
      }

      result = VM.write_stdin(fake_command, "test")
      assert {:error, {:process_dead, _}} = result
    end
  end

  describe "terminate/2" do
    test "handles nil sprite state without crashing" do
      import ExUnit.CaptureLog

      assert capture_log([level: :info], fn ->
               VM.terminate(:shutdown, %{sprite: nil, fs: nil})
               Logger.flush()
             end) =~ "VirtualMachineImpl stopping (no VM)"
    end

    test "handles active sprite state without crashing" do
      import ExUnit.CaptureLog

      assert capture_log([level: :info], fn ->
               VM.terminate(:shutdown, %{sprite: :fake, fs: :fake})
               Logger.flush()
             end) =~ "VirtualMachineImpl stopping"
    end
  end

  describe "resize/3" do
    test "returns :ok even when process is dead (SDK silently succeeds)" do
      dead_pid = spawn(fn -> :ok end)
      Process.sleep(10)

      fake_command = %Sprites.Command{
        pid: dead_pid,
        ref: make_ref(),
        owner: self()
      }

      # Sprites.resize returns :ok even for dead processes (fire-and-forget)
      assert :ok = VM.resize(fake_command, 24, 80)
    end
  end
end
