defmodule Shire.Agents.Message do
  use Ecto.Schema
  import Ecto.Changeset

  schema "messages" do
    field :project_name, :string
    field :agent_name, :string
    field :role, :string
    field :content, :map, default: %{}

    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:project_name, :agent_name, :role, :content])
    |> validate_required([:project_name, :agent_name, :role])
  end
end
