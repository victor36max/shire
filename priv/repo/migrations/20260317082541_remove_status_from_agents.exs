defmodule Shire.Repo.Migrations.RemoveStatusFromAgents do
  use Ecto.Migration

  def change do
    alter table(:agents) do
      remove :status, :string, default: "created"
    end
  end
end
