defmodule Shire.Repo.Migrations.CreateAgents do
  use Ecto.Migration

  def change do
    create table(:agents) do
      add :name, :string, null: false
      add :sprite_name, :string
      add :status, :string, default: "created"
      add :model, :string
      add :system_prompt, :text

      timestamps(type: :utc_datetime)
    end

    create unique_index(:agents, [:name])
  end
end
