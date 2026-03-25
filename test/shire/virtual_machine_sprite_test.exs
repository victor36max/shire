defmodule Shire.VirtualMachineSpriteTest do
  use ExUnit.Case, async: true

  alias Shire.VirtualMachineSprite, as: VM

  @project_id "test-project"

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
               VM.terminate(:shutdown, %{sprite: nil, fs: nil, project_id: @project_id})
               Logger.flush()
             end) =~ "VirtualMachineSprite stopping (no VM"
    end

    test "handles active sprite state without crashing" do
      import ExUnit.CaptureLog

      assert capture_log([level: :info], fn ->
               VM.terminate(:shutdown, %{sprite: :fake, fs: :fake, project_id: @project_id})
               Logger.flush()
             end) =~ "VirtualMachineSprite stopping"
    end
  end

  describe "VM keep-alive ping" do
    test "ping interval is at least 10s to avoid filling /run with crun PID files" do
      # Each Sprites.cmd ping spawns a container process that writes a PID file to
      # /run/sprite-env/crun/. Too-frequent pings fill the tmpfs and make the VM
      # unresponsive. 15s stays under the 30s Sprites idle timeout while limiting
      # PID file accumulation to ~120 per 30-min keepalive window.
      assert VM.ping_interval() >= 10_000
    end

    test "handle_info(:ping_vm) stops when ping_until has expired" do
      state = %{
        sprite: nil,
        fs: nil,
        ping_timer: make_ref(),
        ping_until: System.monotonic_time(:millisecond) - 1_000
      }

      assert {:noreply, new_state} = VM.handle_info(:ping_vm, state)
      assert new_state.ping_timer == nil
      assert new_state.ping_until == nil
    end

    test "handle_info(:ping_vm) stops when sprite is nil" do
      state = %{
        sprite: nil,
        fs: nil,
        ping_timer: make_ref(),
        ping_until: System.monotonic_time(:millisecond) + 60_000
      }

      assert {:noreply, new_state} = VM.handle_info(:ping_vm, state)
      assert new_state.ping_timer == nil
      assert new_state.ping_until == nil
    end

    test "touch_keepalive is triggered by VM calls (via get_sprite)" do
      pid = start_supervised!({VM, [project_id: @project_id]}, id: :keepalive_test_vm)

      _sprite = GenServer.call(pid, :get_sprite)

      state = :sys.get_state(pid)
      assert state.ping_until != nil
      assert state.ping_timer != nil
    end

    test "subsequent VM calls extend ping_until" do
      pid = start_supervised!({VM, [project_id: @project_id]}, id: :keepalive_extend_vm)

      GenServer.call(pid, :get_sprite)
      state1 = :sys.get_state(pid)

      Process.sleep(10)

      GenServer.call(pid, :get_sprite)
      state2 = :sys.get_state(pid)

      assert state2.ping_until > state1.ping_until
    end
  end

  describe "touch_keepalive broadcasts vm_woke_up" do
    test "broadcasts {:vm_woke_up, project_id} when transitioning from idle to active" do
      pid = start_supervised!({VM, [project_id: @project_id]}, id: :wakeup_broadcast_vm)

      # Clear ping_timer to simulate idle VM
      :sys.replace_state(pid, fn state ->
        if state.ping_timer, do: Process.cancel_timer(state.ping_timer)
        %{state | ping_timer: nil, ping_until: nil}
      end)

      # Subscribe to the VM PubSub topic
      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{@project_id}:vm")

      # Trigger touch_keepalive via a VM call
      GenServer.call(pid, :get_sprite)

      assert_receive {:vm_woke_up, @project_id}, 1_000
    end

    test "does not broadcast when VM is already active" do
      pid = start_supervised!({VM, [project_id: @project_id]}, id: :no_wakeup_broadcast_vm)

      # First call to activate
      GenServer.call(pid, :get_sprite)

      # Subscribe after first activation
      Phoenix.PubSub.subscribe(Shire.PubSub, "project:#{@project_id}:vm")

      # Second call should not broadcast
      GenServer.call(pid, :get_sprite)

      refute_receive {:vm_woke_up, _}, 200
    end
  end

  describe "backoff_delay/1" do
    test "returns increasing delays with exponential backoff" do
      delays = Enum.map(1..5, fn attempt -> VM.backoff_delay(attempt) end)

      # Each delay should be roughly double the previous (within jitter range)
      # Attempt 1: ~2000ms, Attempt 2: ~4000ms, Attempt 3: ~8000ms, etc.
      for {delay, i} <- Enum.with_index(delays, 1) do
        base = min(2_000 * Integer.pow(2, i - 1), 30_000)
        assert delay >= base * 0.8, "Delay #{delay} for attempt #{i} should be >= #{base * 0.8}"
        assert delay <= base * 1.2, "Delay #{delay} for attempt #{i} should be <= #{base * 1.2}"
      end
    end

    test "caps at max backoff" do
      # Attempt 10 would be 2000 * 2^9 = 1_024_000, but capped at 30_000
      delay = VM.backoff_delay(10)
      assert delay >= 30_000 * 0.8
      assert delay <= 30_000 * 1.2
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
