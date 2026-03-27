defmodule Shire.Query do
  @moduledoc """
  Cross-database query helpers.

  Provides macros that generate the correct SQL fragments for both
  PostgreSQL and SQLite backends, selected at compile time.
  """

  @db_type Application.compile_env(:shire, :db_type, "sqlite")

  @doc """
  Extracts a text value from a JSON column.

  PostgreSQL: `col->>'key'`
  SQLite: `json_extract(col, '$.key')`
  """
  defmacro json_text(column, key) do
    db_type = @db_type

    if db_type == "sqlite" do
      path = "$." <> key

      quote do
        fragment("json_extract(?, ?)", unquote(column), unquote(path))
      end
    else
      quote do
        fragment("?->>?", unquote(column), unquote(key))
      end
    end
  end
end
