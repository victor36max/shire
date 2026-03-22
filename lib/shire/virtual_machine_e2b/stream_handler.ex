defmodule Shire.VirtualMachineE2B.StreamHandler do
  @moduledoc """
  Handles streaming responses from E2B's process.Process/Start endpoint.

  Spawns a linked process that maintains the HTTP streaming connection and
  forwards output events to the caller using the same message protocol as
  VirtualMachineLocal/VirtualMachineSprite:

    - `{:stdout, %{ref: ref}, data}` for output data
    - `{:exit, %{ref: ref}, exit_code}` for process completion
  """
  require Logger

  alias Shire.VirtualMachineE2B.Client

  defstruct [:ref, :pid, :sandbox_id, :access_token, :process_pid, :tty]

  def start_link(sandbox_id, access_token, cmd, args, opts) do
    caller = Keyword.get(opts, :caller, self())
    ref = make_ref()
    tty = Keyword.get(opts, :tty, false)

    handler_state = %{
      sandbox_id: sandbox_id,
      access_token: access_token,
      tty: tty
    }

    pid =
      spawn_link(fn ->
        run_stream(handler_state, cmd, args, opts, caller, ref)
      end)

    {:ok, %{ref: ref, pid: pid}}
  end

  defp run_stream(handler_state, cmd, args, opts, caller, ref) do
    Process.flag(:trap_exit, true)

    case Client.start_process(
           handler_state.sandbox_id,
           handler_state.access_token,
           cmd,
           args,
           opts
         ) do
      {:ok, resp} ->
        stream_loop(resp, caller, ref, handler_state, nil, false)

      {:error, reason} ->
        Logger.error("E2B stream start failed: #{inspect(reason)}")
        send(caller, {:exit, %{ref: ref}, 1})
    end
  end

  defp stream_loop(resp, caller, ref, handler_state, e2b_pid, got_exit) do
    receive do
      {_ref, {:data, data}} ->
        {new_pid, new_got_exit} = handle_stream_data(data, caller, ref, e2b_pid, got_exit)

        stream_loop(
          resp,
          caller,
          ref,
          handler_state,
          new_pid || e2b_pid,
          new_got_exit || got_exit
        )

      {_ref, :done} ->
        # If we never received an exit event, send one so the caller doesn't hang
        unless got_exit do
          send(caller, {:exit, %{ref: ref}, 1})
        end

      {:write, data} ->
        if e2b_pid do
          Client.send_input(
            handler_state.sandbox_id,
            handler_state.access_token,
            e2b_pid,
            data,
            tty: handler_state.tty
          )
        end

        stream_loop(resp, caller, ref, handler_state, e2b_pid, got_exit)

      {:resize, rows, cols} ->
        if e2b_pid do
          Client.update_process(
            handler_state.sandbox_id,
            handler_state.access_token,
            e2b_pid,
            rows,
            cols
          )
        end

        stream_loop(resp, caller, ref, handler_state, e2b_pid, got_exit)

      {:EXIT, _from, _reason} ->
        :ok
    end
  end

  defp handle_stream_data(data, caller, ref, current_pid, got_exit) when is_binary(data) do
    data
    |> String.split("\n", trim: true)
    |> Enum.reduce({current_pid, got_exit}, fn line, {pid, exited} ->
      case Jason.decode(line) do
        {:ok, %{"result" => result}} ->
          case handle_event(result, caller, ref) do
            {:pid, new_pid} -> {new_pid, exited}
            :exit -> {pid, true}
            :ok -> {pid, exited}
          end

        {:ok, %{"error" => error}} ->
          Logger.error("E2B process error: #{inspect(error)}")
          send(caller, {:exit, %{ref: ref}, 1})
          {pid, true}

        _ ->
          {pid, exited}
      end
    end)
  end

  defp handle_stream_data(_data, _caller, _ref, current_pid, got_exit),
    do: {current_pid, got_exit}

  defp handle_event(%{"event" => %{"start" => %{"pid" => pid}}}, _caller, _ref) do
    {:pid, pid}
  end

  defp handle_event(%{"event" => %{"data" => %{"stdout" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    :ok
  end

  defp handle_event(%{"event" => %{"data" => %{"stderr" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    :ok
  end

  defp handle_event(%{"event" => %{"data" => %{"pty" => data}}}, caller, ref) do
    send(caller, {:stdout, %{ref: ref}, Base.decode64!(data)})
    :ok
  end

  defp handle_event(%{"event" => %{"end" => %{"exitCode" => code}}}, caller, ref) do
    send(caller, {:exit, %{ref: ref}, code})
    :exit
  end

  defp handle_event(%{"event" => %{"end" => _}}, caller, ref) do
    send(caller, {:exit, %{ref: ref}, 0})
    :exit
  end

  defp handle_event(_event, _caller, _ref), do: :ok
end
