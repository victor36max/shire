defmodule Shire.Slug do
  @moduledoc """
  Shared slug validation for project and agent names.
  Slugs must be lowercase alphanumeric with dashes, starting and ending with a letter or number.
  """

  @regex ~r/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

  @doc "Returns the slug validation regex."
  def regex, do: @regex

  @doc "Returns true if the given string is a valid slug."
  def valid?(name) when is_binary(name) do
    String.length(name) >= 1 and String.length(name) <= 63 and
      Regex.match?(@regex, name)
  end

  def valid?(_), do: false

  @doc """
  Slugifies a string: lowercases, replaces non-alphanumeric chars with dashes,
  strips leading/trailing dashes, and collapses consecutive dashes.
  """
  def slugify(name) when is_binary(name) do
    name
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9-]/, "-")
    |> String.replace(~r/-+/, "-")
    |> String.trim("-")
  end
end
