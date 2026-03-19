defmodule Shire.Projects.Project do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "projects" do
    field :name, :string

    has_many :agents, Shire.Agents.Agent

    timestamps(type: :utc_datetime)
  end

  def changeset(project, attrs) do
    project
    |> cast(attrs, [:name])
    |> validate_required([:name])
    |> unique_constraint(:name)
  end
end
