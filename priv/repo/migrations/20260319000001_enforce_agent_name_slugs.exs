defmodule Shire.Repo.Migrations.EnforceAgentNameSlugs do
  use Ecto.Migration

  def up do
    # Slugify existing non-compliant agent names in messages table.
    # Note: this bulk UPDATE can produce collisions if two names like "My Agent"
    # and "my-agent" both exist. This is intentional — agent_name in the messages
    # table is not unique-constrained (multiple messages reference the same agent),
    # so collisions simply normalize different spellings to the canonical slug form.
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
