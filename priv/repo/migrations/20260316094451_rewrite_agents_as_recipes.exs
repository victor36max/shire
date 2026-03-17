defmodule Shire.Repo.Migrations.RewriteAgentsAsRecipes do
  use Ecto.Migration

  def change do
    # Drop dependent tables first (they reference agents)
    drop_if_exists table(:messages)
    drop_if_exists table(:secrets)
    drop_if_exists table(:agents)

    # Recreate agents table with recipe-based schema
    create table(:agents) do
      add :recipe, :text, null: false
      add :is_base, :boolean, default: false, null: false
      add :status, :string, default: "created", null: false

      timestamps(type: :utc_datetime)
    end

    # Recreate secrets table
    create table(:secrets) do
      add :key, :string, null: false
      add :value, :binary, null: false
      add :agent_id, references(:agents, on_delete: :delete_all), null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:secrets, [:agent_id, :key])

    # Recreate messages table
    create table(:messages) do
      add :agent_id, references(:agents, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :content, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:agent_id])
  end
end
