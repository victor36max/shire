defmodule ShireWeb.AgentLive.AgentStreaming do
  @moduledoc """
  Shared agent event streaming logic for AgentLive views.
  Processes real-time agent events and updates socket assigns for display.
  Message persistence is handled by AgentManager — this module is display-only.
  """

  @doc """
  Processes an agent event and returns an updated socket.
  Expects the socket to have :messages and :streaming_text assigns.
  """
  def process_agent_event(socket, event) do
    # Strip ephemeral streaming entry from previous render
    messages = Enum.reject(socket.assigns.messages, &(&1[:role] == "agent_streaming"))
    streaming_text = socket.assigns.streaming_text

    {messages, streaming_text} = handle_event(messages, streaming_text, event)

    display_messages =
      if streaming_text do
        messages ++
          [
            %{
              role: "agent_streaming",
              text: streaming_text,
              ts: DateTime.utc_now() |> to_string()
            }
          ]
      else
        messages
      end

    Phoenix.Component.assign(socket, messages: display_messages, streaming_text: streaming_text)
  end

  defp handle_event(messages, streaming_text, event) do
    case event do
      %{"type" => "text_delta", "payload" => %{"delta" => delta}} ->
        {messages, (streaming_text || "") <> delta}

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
            {messages ++ [msg], streaming_text}

          _ ->
            update_tool_use_in_list(
              messages,
              tool_use_id,
              fn msg ->
                %{msg | input: input}
              end,
              streaming_text
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
          end,
          streaming_text
        )

      %{"type" => "text", "message" => msg} ->
        # AgentManager already persisted; just append to display
        {messages ++ [msg], nil}

      %{"type" => "text", "payload" => %{"text" => _text}} ->
        # Fallback: no message included
        {messages, nil}

      %{"type" => "inter_agent_message", "message" => msg} ->
        {messages ++ [msg], streaming_text}

      %{"type" => "system_message", "message" => msg} ->
        {messages ++ [msg], streaming_text}

      %{"type" => "turn_complete"} ->
        {messages, nil}

      _ ->
        {messages, streaming_text}
    end
  end

  defp update_tool_use_in_list(messages, tool_use_id, update_fn, streaming_text) do
    idx =
      Enum.find_index(Enum.reverse(messages), fn msg ->
        msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
      end)

    if idx do
      real_idx = length(messages) - 1 - idx
      tool_msg = Enum.at(messages, real_idx)
      updated = update_fn.(tool_msg)
      {List.replace_at(messages, real_idx, updated), streaming_text}
    else
      {messages, streaming_text}
    end
  end
end
