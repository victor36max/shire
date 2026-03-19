defmodule Shire.Repo.Migrations.EnforceAgentNameSlugs do
  use Ecto.Migration

  def up do
    # Slugify existing non-compliant agent names in agents table.
    # The agents table has a unique index on (project_id, name), so we use
    # a CTE with ROW_NUMBER to handle potential collisions by appending a
    # numeric suffix to duplicates.
    execute("""
    WITH slugged AS (
      SELECT id,
             LOWER(
               TRIM(BOTH '-' FROM
                 REGEXP_REPLACE(
                   REGEXP_REPLACE(LOWER(name), '[^a-z0-9-]', '-', 'g'),
                   '-+', '-', 'g'
                 )
               )
             ) AS new_name,
             project_id
      FROM agents
      WHERE name !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
        AND name !~ '^[a-z0-9]$'
    ),
    numbered AS (
      SELECT id, new_name, project_id,
             ROW_NUMBER() OVER (PARTITION BY project_id, new_name ORDER BY id) AS rn
      FROM slugged
    )
    UPDATE agents
    SET name = CASE
      WHEN numbered.rn = 1 THEN numbered.new_name
      ELSE numbered.new_name || '-' || numbered.rn
    END
    FROM numbered
    WHERE agents.id = numbered.id
    """)
  end

  def down do
    # Data migration — cannot be reversed
    :ok
  end
end
