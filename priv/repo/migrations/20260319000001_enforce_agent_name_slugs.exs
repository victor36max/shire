defmodule Shire.Repo.Migrations.EnforceAgentNameSlugs do
  use Ecto.Migration

  def up do
    # No-op: this migration originally targeted the old messages.agent_name column,
    # but the messages table was recreated without that column in 20260319031951.
    # The agents table (which has the name column) is also created in that later
    # migration, so it doesn't exist yet at this timestamp. Slug validation is now
    # enforced at the application layer on agent creation/rename.
    :ok
  end

  def down do
    # Data migration — cannot be reversed
    :ok
  end
end
