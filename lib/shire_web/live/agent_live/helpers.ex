defmodule ShireWeb.AgentLive.Helpers do
  @moduledoc """
  Shared serialization helpers for AgentLive views.
  """

  alias Shire.Agents

  def serialize_message(%Agents.Message{} = msg) do
    base = %{id: msg.id, role: msg.role, ts: msg.inserted_at |> to_string()}

    case msg.role do
      "tool_use" ->
        Map.merge(base, %{
          tool: msg.content["tool"],
          tool_use_id: msg.content["tool_use_id"],
          input: msg.content["input"],
          output: msg.content["output"],
          is_error: msg.content["is_error"] || false
        })

      "inter_agent" ->
        Map.merge(base, %{
          text: msg.content["text"],
          from_agent: msg.content["from_agent"]
        })

      _ ->
        base
        |> Map.put(:text, msg.content["text"])
        |> Map.put(:attachments, msg.content["attachments"] || [])
    end
  end
end
