defmodule Shire.Repo.Migrations.CreateSecrets do
  use Ecto.Migration

  def change do
    create table(:secrets) do
      add :key, :string, null: false
      add :value, :binary, null: false
      add :agent_id, references(:agents, on_delete: :delete_all), null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:secrets, [:agent_id, :key])
  end
end
