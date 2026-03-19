defmodule Shire.Repo.Migrations.EnforceAgentNameSlugs do
  use Ecto.Migration

  def up do
    # Slugify existing non-compliant agent names in messages table
    execute("""
    UPDATE messages
    SET agent_name = LOWER(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(
          REGEXP_REPLACE(LOWER(agent_name), '[^a-z0-9-]', '-', 'g'),
          '-+', '-', 'g'
        )
      )
    )
    WHERE agent_name !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      AND agent_name !~ '^[a-z0-9]$'
    """)
  end

  def down do
    # Data migration — cannot be reversed
    :ok
  end
end
