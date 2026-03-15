defmodule SpriteAgents.Agents.Secret do
  use Ecto.Schema
  import Ecto.Changeset

  schema "secrets" do
    field :key, :string
    field :value, SpriteAgents.Encrypted.Binary
    belongs_to :agent, SpriteAgents.Agents.Agent

    timestamps(type: :utc_datetime)
  end

  def changeset(secret, attrs) do
    secret
    |> cast(attrs, [:key, :value, :agent_id])
    |> validate_required([:key, :value])
    |> unique_constraint([:agent_id, :key])
  end
end
