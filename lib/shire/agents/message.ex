defmodule Shire.Agents.Message do
  use Ecto.Schema
  import Ecto.Changeset

  @foreign_key_type :binary_id

  schema "messages" do
    belongs_to :project, Shire.Projects.Project
    belongs_to :agent, Shire.Agents.Agent
    field :role, :string
    field :content, :map, default: %{}

    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:project_id, :agent_id, :role, :content])
    |> validate_required([:project_id, :agent_id, :role])
    |> foreign_key_constraint(:project_id)
    |> foreign_key_constraint(:agent_id)
  end
end
