defmodule Shire.Repo.Migrations.SingleVmRefactor do
  use Ecto.Migration

  def change do
    drop table(:messages)
    drop table(:secrets)
    drop table(:agents)

    create table(:messages) do
      add :agent_name, :string, null: false
      add :role, :string, null: false
      add :content, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:agent_name])
  end
end
