defmodule Shire.Repo.Migrations.AddObanAndScheduledTasks do
  use Ecto.Migration

  def up do
    Oban.Migration.up(version: 12)

    create table(:scheduled_tasks, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all),
        null: false

      add :agent_id, references(:agents, type: :binary_id, on_delete: :delete_all), null: false
      add :label, :string, null: false
      add :message, :text, null: false
      add :schedule_type, :string, null: false
      add :cron_expression, :string
      add :scheduled_at, :utc_datetime
      add :enabled, :boolean, default: true, null: false
      add :last_run_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:scheduled_tasks, [:project_id])
    create index(:scheduled_tasks, [:agent_id])
  end

  def down do
    drop table(:scheduled_tasks)
    Oban.Migration.down(version: 1)
  end
end
