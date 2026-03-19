defmodule Shire.Agents.Agent do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "agents" do
    field :name, :string

    belongs_to :project, Shire.Projects.Project
    has_many :messages, Shire.Agents.Message

    timestamps(type: :utc_datetime)
  end

  def changeset(agent, attrs) do
    agent
    |> cast(attrs, [:name, :project_id])
    |> validate_required([:name, :project_id])
    |> unique_constraint([:project_id, :name], name: :agents_project_id_name_index)
    |> foreign_key_constraint(:project_id)
  end
end
