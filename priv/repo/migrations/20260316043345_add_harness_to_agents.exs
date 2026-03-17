defmodule Shire.Repo.Migrations.AddHarnessToAgents do
  use Ecto.Migration

  def change do
    alter table(:agents) do
      add :harness, :string, default: "claude_code", null: false
    end
  end
end
