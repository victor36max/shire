defmodule SpriteAgents.Repo.Migrations.AddHarnessToAgents do
  use Ecto.Migration

  def change do
    alter table(:agents) do
      add :harness, :string, default: "pi", null: false
    end
  end
end
