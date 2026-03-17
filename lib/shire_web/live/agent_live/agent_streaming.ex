defmodule ShireWeb.AgentLive.AgentStreaming do
  @moduledoc """
  Shared agent event streaming logic for AgentLive views.
  Processes real-time agent events (text deltas, tool calls, etc.)
  and updates socket assigns accordingly.
  """

  alias Shire.Agents
  alias ShireWeb.AgentLive.Helpers

  @doc """
  Processes an agent event and returns an updated socket.
  Expects the socket to have :messages, :streaming_text, and either
  :agent (for show) or :selected_agent (for index) assigns with an :id field.
  """
  def process_agent_event(socket, event, agent_id) do
    # Strip ephemeral streaming entry from previous render
    messages = Enum.reject(socket.assigns.messages, &(&1[:role] == "agent_streaming"))
    streaming_text = socket.assigns.streaming_text

    {messages, streaming_text} = handle_event(messages, streaming_text, event, agent_id)

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

  defp handle_event(messages, streaming_text, event, agent_id) do
    case event do
      %{"type" => "text_delta", "payload" => %{"delta" => delta}} ->
        {messages, (streaming_text || "") <> delta}

      %{"type" => "tool_use", "payload" => %{"status" => "started"} = payload} ->
        tool = Map.get(payload, "tool", "unknown")
        tool_use_id = Map.get(payload, "tool_use_id", "")
        input = Map.get(payload, "input", %{})

        messages = flush_streaming(messages, streaming_text, agent_id)

        {:ok, msg} =
          Agents.create_message(%{
            agent_id: agent_id,
            role: "tool_use",
            content: %{
              "tool" => tool,
              "tool_use_id" => tool_use_id,
              "input" => input,
              "output" => nil,
              "is_error" => false
            }
          })

        {messages ++ [Helpers.serialize_message(msg)], nil}

      %{"type" => "tool_use", "payload" => %{"status" => "input_ready"} = payload} ->
        tool_use_id = Map.get(payload, "tool_use_id", "")
        input = Map.get(payload, "input", %{})

        idx =
          Enum.find_index(Enum.reverse(messages), fn msg ->
            msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
          end)

        if idx do
          real_idx = length(messages) - 1 - idx
          tool_msg = Enum.at(messages, real_idx)

          if db_id = tool_msg[:id] do
            db_msg = Agents.get_message!(db_id)

            Agents.update_message(db_msg, %{
              content: Map.merge(db_msg.content, %{"input" => input})
            })
          end

          updated = %{tool_msg | input: input}
          {List.replace_at(messages, real_idx, updated), streaming_text}
        else
          tool = Map.get(payload, "tool", "unknown")
          messages = flush_streaming(messages, streaming_text, agent_id)

          {:ok, msg} =
            Agents.create_message(%{
              agent_id: agent_id,
              role: "tool_use",
              content: %{
                "tool" => tool,
                "tool_use_id" => tool_use_id,
                "input" => input,
                "output" => nil,
                "is_error" => false
              }
            })

          {messages ++ [Helpers.serialize_message(msg)], nil}
        end

      %{"type" => "tool_result", "payload" => payload} ->
        tool_use_id = Map.get(payload, "tool_use_id", "")
        output = Map.get(payload, "output", "")
        is_error = Map.get(payload, "is_error", false)

        idx =
          Enum.find_index(Enum.reverse(messages), fn msg ->
            msg[:role] == "tool_use" && msg[:tool_use_id] == tool_use_id
          end)

        if idx do
          real_idx = length(messages) - 1 - idx
          tool_msg = Enum.at(messages, real_idx)

          if db_id = tool_msg[:id] do
            db_msg = Agents.get_message!(db_id)

            Agents.update_message(db_msg, %{
              content: Map.merge(db_msg.content, %{"output" => output, "is_error" => is_error})
            })
          end

          updated = %{tool_msg | output: output, is_error: is_error}
          {List.replace_at(messages, real_idx, updated), streaming_text}
        else
          {messages, streaming_text}
        end

      %{"type" => "turn_complete"} ->
        messages = flush_streaming(messages, streaming_text, agent_id)
        {messages, nil}

      %{"type" => "text", "payload" => %{"text" => text}} ->
        messages = flush_streaming(messages, streaming_text, agent_id)

        {:ok, msg} =
          Agents.create_message(%{
            agent_id: agent_id,
            role: "agent",
            content: %{"text" => text}
          })

        {messages ++ [Helpers.serialize_message(msg)], nil}

      _ ->
        {messages, streaming_text}
    end
  end

  defp flush_streaming(messages, nil, _agent_id), do: messages
  defp flush_streaming(messages, "", _agent_id), do: messages

  defp flush_streaming(messages, text, agent_id) do
    {:ok, msg} =
      Agents.create_message(%{agent_id: agent_id, role: "agent", content: %{"text" => text}})

    messages ++ [Helpers.serialize_message(msg)]
  end
end
