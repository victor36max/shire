defmodule Shire.Repo.Migrations.AddProjectNameToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :project_name, :string, null: false, default: "default"
    end

    create index(:messages, [:project_name, :agent_name])
    drop_if_exists index(:messages, [:agent_name])
  end
end
