defmodule SpriteAgents.Repo.Migrations.CreateMessages do
  use Ecto.Migration

  def change do
    create table(:messages) do
      add :agent_id, references(:agents, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :content, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:agent_id])
  end
end
