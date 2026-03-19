defmodule Shire.Repo.Migrations.AddProjectsAgentsTables do
  use Ecto.Migration

  def change do
    # Create projects table
    create table(:projects, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:projects, [:name])

    # Create agents table
    create table(:agents, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false

      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all),
        null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:agents, [:project_id, :name])

    # Drop and recreate messages with FK references
    drop table(:messages)

    create table(:messages) do
      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all),
        null: false

      add :agent_id, references(:agents, type: :binary_id, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :content, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:project_id, :agent_id])
  end
end
