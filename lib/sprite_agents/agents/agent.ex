defmodule SpriteAgents.Agents.Agent do
  use Ecto.Schema
  import Ecto.Changeset

  schema "agents" do
    field :name, :string
    field :sprite_name, :string

    field :status, Ecto.Enum,
      values: [:created, :starting, :active, :sleeping, :failed, :destroyed],
      default: :created

    field :harness, Ecto.Enum,
      values: [:pi, :claude_code],
      default: :pi

    field :model, :string
    field :system_prompt, :string

    has_many :secrets, SpriteAgents.Agents.Secret
    timestamps(type: :utc_datetime)
  end

  def changeset(agent, attrs) do
    agent
    |> cast(attrs, [:name, :sprite_name, :status, :harness, :model, :system_prompt])
    |> validate_required([:name])
    |> unique_constraint(:name)
  end
end
