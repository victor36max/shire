defmodule Shire.Catalog do
  @moduledoc """
  Reads agent catalog from static YAML files in priv/catalog/.
  No GenServer needed — files are read on demand.
  """

  defmodule Agent do
    @moduledoc false

    @type t :: %__MODULE__{
            name: String.t(),
            display_name: String.t(),
            description: String.t(),
            category: String.t(),
            emoji: String.t(),
            tags: [String.t()],
            harness: String.t(),
            model: String.t(),
            system_prompt: String.t()
          }

    defstruct [
      :name,
      :display_name,
      :description,
      :category,
      :emoji,
      :harness,
      :model,
      :system_prompt,
      tags: []
    ]
  end

  @spec list_agents() :: [Agent.t()]
  def list_agents do
    catalog_dir()
    |> Path.join("agents/**/*.yaml")
    |> Path.wildcard()
    |> Enum.map(&load_agent/1)
    |> Enum.reject(&is_nil/1)
  end

  @spec list_agents(keyword()) :: [Agent.t()]
  def list_agents(category: category) do
    list_agents()
    |> Enum.filter(&(&1.category == category))
  end

  def list_agents(_opts), do: list_agents()

  @spec get_agent(String.t()) :: Agent.t() | nil
  def get_agent(name) when is_binary(name) do
    if String.contains?(name, ["..", "/", "\\"]) do
      nil
    else
      case Path.wildcard(Path.join(catalog_dir(), "agents/**/#{name}.yaml")) do
        [path | _] -> load_agent(path)
        [] -> nil
      end
    end
  end

  @spec list_categories() :: [map()]
  def list_categories do
    path = Path.join(catalog_dir(), "categories.yaml")

    case YamlElixir.read_from_file(path) do
      {:ok, categories} ->
        Enum.map(categories, fn cat ->
          %{
            id: cat["id"],
            name: cat["name"],
            description: cat["description"] || ""
          }
        end)

      {:error, _} ->
        []
    end
  end

  @spec search(String.t()) :: [Agent.t()]
  def search(query) do
    query_down = String.downcase(query)

    list_agents()
    |> Enum.filter(fn agent ->
      String.contains?(String.downcase(agent.display_name || ""), query_down) or
        String.contains?(String.downcase(agent.description || ""), query_down) or
        Enum.any?(agent.tags || [], &String.contains?(String.downcase(&1), query_down))
    end)
  end

  defp load_agent(path) do
    case YamlElixir.read_from_file(path) do
      {:ok, data} ->
        %Agent{
          name: data["name"],
          display_name: data["display_name"],
          description: data["description"] || "",
          category: data["category"] || "",
          emoji: data["emoji"] || "",
          tags: data["tags"] || [],
          harness: data["harness"] || "claude_code",
          model: data["model"] || "claude-sonnet-4-6",
          system_prompt: data["system_prompt"] || ""
        }

      {:error, _} ->
        nil
    end
  end

  defp catalog_dir do
    Application.get_env(:shire, :catalog_dir) || Application.app_dir(:shire, "priv/catalog")
  end
end
