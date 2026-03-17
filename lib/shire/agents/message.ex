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
  end
end
