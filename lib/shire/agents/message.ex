defmodule Shire.Agents.Message do
  use Ecto.Schema
  import Ecto.Changeset

  schema "messages" do
    field :role, :string
    field :content, :map, default: %{}

    belongs_to :agent, Shire.Agents.Agent
    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:agent_id, :role, :content])
    |> validate_required([:agent_id, :role])
    |> foreign_key_constraint(:agent_id)
  end
end
