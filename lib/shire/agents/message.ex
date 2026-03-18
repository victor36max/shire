defmodule Shire.Agents.Message do
  use Ecto.Schema
  import Ecto.Changeset

  schema "messages" do
    field :agent_name, :string
    field :role, :string
    field :content, :map, default: %{}

    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:agent_name, :role, :content])
    |> validate_required([:agent_name, :role])
    |> validate_inclusion(:role, ["user", "agent", "tool_use", "tool_result", "inter_agent"])
    |> validate_format(:agent_name, ~r/^[a-zA-Z0-9_\-]+$/,
      message: "must be alphanumeric with hyphens/underscores only"
    )
  end

  @doc "Serializes a Message struct to a plain map suitable for JSON transport."
  def serialize(%__MODULE__{} = msg) do
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
        Map.put(base, :text, msg.content["text"])
    end
  end
end
