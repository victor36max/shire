defmodule ShireWeb.AgentLive.AgentStreaming do
  @moduledoc """
  Shared agent event streaming logic for AgentLive views.
  Processes real-time agent events and updates socket assigns for display.
  Message persistence is handled by AgentManager — this module is display-only.

  Text deltas are sent via push_event to the client for lightweight streaming,
  avoiding full messages list re-serialization on every token.
  """

  @doc """
  Processes an agent event and returns an updated socket.
  Expects the socket to have :messages and :streaming_text assigns.

  Text deltas are pushed directly to the client via push_event ("text_delta").
  All other events update the messages assign and push a "streaming_flush"
  event when streaming text was pending, so the client clears its local buffer.
  """
  def process_agent_event(socket, %{"type" => "text_delta", "payload" => %{"delta" => delta}}) do
    socket
    |> Phoenix.LiveView.push_event("text_delta", %{delta: delta})
    |> Phoenix.Component.assign(streaming_text: (socket.assigns.streaming_text || "") <> delta)
  end

  def process_agent_event(socket, event) do
    messages = socket.assigns.messages
    streaming_text = socket.assigns.streaming_text

    {messages, streaming_text} = handle_event(messages, streaming_text, event)

    socket
    |> maybe_push_flush(socket.assigns.streaming_text, streaming_text)
    |> Phoenix.Component.assign(messages: messages, streaming_text: streaming_text)
  end

  # Push a flush event when streaming_text transitions from non-nil to nil
  defp maybe_push_flush(socket, old_streaming, new_streaming)
       when old_streaming != nil and new_streaming == nil do
    Phoenix.LiveView.push_event(socket, "streaming_flush", %{})
  end

  defp maybe_push_flush(socket, _old, _new), do: socket

  defp handle_event(messages, _streaming_text, event) do
    case event do
      %{"type" => "tool_use", "payload" => %{"status" => "started"}, "message" => msg} ->
        # AgentManager already persisted and flushed streaming text
        {messages ++ [msg], nil}

      %{"type" => "tool_use", "payload" => %{"status" => "started"} = payload} ->
        # Fallback: no message included (e.g. persistence failed)
        tool = Map.get(payload, "tool", "unknown")
        tool_use_id = Map.get(payload, "tool_use_id", "")
        input = Map.get(payload, "input", %{})

        msg = %{
          role: "tool_use",
          tool: tool,
          tool_use_id: tool_use_id,
          input: input,
          output: nil,
          is_error: false,
          ts: DateTime.utc_now() |> to_string()
        }

        {messages ++ [msg], nil}

      %{"type" => "tool_use", "payload" => %{"status" => "input_ready"} = payload} = evt ->
        tool_use_id = Map.get(payload, "tool_use_id", "")
        input = Map.get(payload, "input", %{})

        # Check if this came with a new message (no prior tool_use found)
        case evt do
          %{"message" => msg} ->
            {messages ++ [msg], nil}

          _ ->
            update_tool_use_in_list(
              messages,
              tool_use_id,
              fn msg ->
                %{msg | input: input}
              end
            )
        end

      %{"type" => "tool_result", "payload" => payload} ->
        tool_use_id = Map.get(payload, "tool_use_id", "")
        output = Map.get(payload, "output", "")
        is_error = Map.get(payload, "is_error", false)

        update_tool_use_in_list(
          messages,
          tool_use_id,
          fn msg ->
            %{msg | output: output, is_error: is_error}
          end
        )

      %{"type" => "text", "message" => msg} ->
        # AgentManager already persisted; just append to display
        {messages ++ [msg], nil}

      %{"type" => "text", "payload" => %{"text" => _text}} ->
        # Fallback: no message included
        {messages, nil}

      %{"type" => "inter_agent_message", "message" => msg} ->
        {messages ++ [msg], nil}

      %{"type" => "system_message", "message" => msg} ->
        {messages ++ [msg], nil}

      %{"type" => "attachment", "message" => msg} ->
        {messages ++ [msg], nil}

      %{"type" => "turn_complete"} ->
        {messages, nil}

      _ ->
        {messages, nil}
    end
  end

  defp update_tool_use_in_list(messages, tool_use_id, update_fn) do
    idx =
      Enum.find_index(Enum.reverse(messages), fn msg ->
        msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
      end)

    if idx do
      real_idx = length(messages) - 1 - idx
      tool_msg = Enum.at(messages, real_idx)
      updated = update_fn.(tool_msg)
      {List.replace_at(messages, real_idx, updated), nil}
    else
      {messages, nil}
    end
  end
end
