defmodule ShireWeb.AgentLive.Helpers do
  @moduledoc """
  Shared serialization helpers for AgentLive views.
  """

  alias Shire.Agents.Message

  def serialize_message(%Message{} = msg) do
    Message.serialize(msg)
  end
end
