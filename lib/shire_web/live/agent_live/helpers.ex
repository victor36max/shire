defmodule ShireWeb.AgentLive.Helpers do
  @moduledoc """
  Shared serialization helpers for AgentLive views.
  """

  alias Shire.Agents

  # Placeholder: accepts any map/struct and returns it as-is.
  # Will be fully rewritten in Phase 4.
  def serialize_agents(agents, _busy_agents \\ MapSet.new(), _statuses \\ %{}),
    do: Enum.map(agents, &serialize_agent(&1))

  def serialize_agent(nil), do: nil
  def serialize_agent(agent), do: agent

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

      _ ->
        Map.put(base, :text, msg.content["text"])
    end
  end
end
