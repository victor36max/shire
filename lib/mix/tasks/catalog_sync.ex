defmodule Mix.Tasks.Catalog.Sync do
  @moduledoc """
  Syncs agent catalog from an external GitHub repo.

  ## Usage

      mix catalog.sync [--repo URL] [--clear]

  ## Options

    * `--repo` - GitHub repo URL (default: https://github.com/msitarzewski/agency-agents)
    * `--clear` - Remove existing catalog before sync
  """
  @shortdoc "Sync agent catalog from external repo"

  use Mix.Task

  @default_repo "https://github.com/msitarzewski/agency-agents"
  @skip_dirs ~w(.github integrations examples .git)

  @impl Mix.Task
  def run(args) do
    {opts, _, _} =
      OptionParser.parse(args, strict: [repo: :string, clear: :boolean])

    repo = opts[:repo] || @default_repo
    catalog_dir = Path.join(File.cwd!(), "priv/catalog")

    if opts[:clear] do
      Mix.shell().info("Clearing existing catalog...")
      File.rm_rf!(catalog_dir)
    end

    tmp_dir = Path.join(System.tmp_dir!(), "catalog_sync_#{:erlang.unique_integer([:positive])}")

    try do
      Mix.shell().info("Cloning #{repo}...")

      case System.cmd("git", ["clone", "--depth", "1", repo, tmp_dir], stderr_to_stdout: true) do
        {_, 0} -> :ok
        {output, _} -> Mix.raise("Failed to clone repo: #{output}")
      end

      {agents_count, categories} = process_repo(tmp_dir, catalog_dir)
      write_categories(catalog_dir, categories)

      Mix.shell().info("Synced #{agents_count} agents across #{length(categories)} categories")
    after
      File.rm_rf!(tmp_dir)
    end
  end

  defp process_repo(repo_dir, catalog_dir) do
    entries = File.ls!(repo_dir)

    categories =
      entries
      |> Enum.filter(fn entry ->
        path = Path.join(repo_dir, entry)
        File.dir?(path) and entry not in @skip_dirs
      end)
      |> Enum.filter(fn dir ->
        path = Path.join(repo_dir, dir)
        path |> File.ls!() |> Enum.any?(&String.ends_with?(&1, ".md"))
      end)

    agents_count =
      categories
      |> Enum.map(fn category ->
        category_path = Path.join(repo_dir, category)
        out_dir = Path.join([catalog_dir, "agents", category])
        File.mkdir_p!(out_dir)

        category_path
        |> File.ls!()
        |> Enum.filter(&String.ends_with?(&1, ".md"))
        |> Enum.reject(&(&1 == "README.md"))
        |> Enum.count(fn file ->
          content = File.read!(Path.join(category_path, file))
          {frontmatter, body} = parse_frontmatter(content)

          if frontmatter["name"] do
            yaml_map = build_agent_yaml(frontmatter, body, category)
            slug = yaml_map["name"]
            yaml_content = encode_agent_yaml(yaml_map)
            File.write!(Path.join(out_dir, "#{slug}.yaml"), yaml_content)
            true
          else
            false
          end
        end)
      end)
      |> Enum.sum()

    category_maps =
      categories
      |> Enum.map(fn cat ->
        %{
          "id" => cat,
          "name" =>
            cat
            |> String.replace("-", " ")
            |> String.split()
            |> Enum.map_join(" ", &String.capitalize/1),
          "description" => "#{String.capitalize(cat)} agents"
        }
      end)

    {agents_count, category_maps}
  end

  defp write_categories(catalog_dir, categories) do
    File.mkdir_p!(catalog_dir)
    yaml_content = encode_categories_yaml(categories)
    File.write!(Path.join(catalog_dir, "categories.yaml"), yaml_content)
  end

  # Manual YAML encoding (yaml_elixir is read-only)

  defp encode_agent_yaml(map) do
    [
      "name: #{map["name"]}",
      "display_name: #{yaml_quote(map["display_name"])}",
      "description: #{yaml_quote(map["description"])}",
      "category: #{map["category"]}",
      "emoji: #{yaml_quote(map["emoji"])}",
      "tags: #{encode_tags(map["tags"])}",
      "harness: #{map["harness"]}",
      "model: #{map["model"]}",
      "system_prompt: |",
      indent(map["system_prompt"] || "", "  ")
    ]
    |> Enum.join("\n")
    |> Kernel.<>("\n")
  end

  defp encode_categories_yaml(categories) do
    categories
    |> Enum.map(fn cat ->
      "- id: #{cat["id"]}\n  name: #{yaml_quote(cat["name"])}\n  description: #{yaml_quote(cat["description"])}"
    end)
    |> Enum.join("\n")
    |> Kernel.<>("\n")
  end

  defp yaml_quote(nil), do: ~s("")
  defp yaml_quote(""), do: ~s("")

  defp yaml_quote(s) do
    ~s("#{String.replace(s, "\"", "\\\"")}")
  end

  defp encode_tags(nil), do: "[]"
  defp encode_tags([]), do: "[]"

  defp encode_tags(tags) when is_list(tags) do
    items = Enum.map_join(tags, ", ", &to_string/1)
    "[#{items}]"
  end

  defp encode_tags(_), do: "[]"

  defp indent(text, prefix) do
    text
    |> String.split("\n")
    |> Enum.map_join("\n", &(prefix <> &1))
  end

  @doc "Parses YAML frontmatter from markdown content. Returns {frontmatter_map, body_string}."
  def parse_frontmatter(content) do
    case String.split(String.trim_leading(content), "---", parts: 3) do
      ["", frontmatter, body] ->
        case YamlElixir.read_from_string(frontmatter) do
          {:ok, parsed} -> {parsed, String.trim(body)}
          {:error, _} -> {%{}, String.trim(content)}
        end

      _ ->
        {%{}, String.trim(content)}
    end
  end

  @doc "Converts a display name to a URL-safe slug."
  def slugify(name) do
    name
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9\s-]/, "-")
    |> String.replace(~r/\s+/, "-")
    |> String.replace(~r/-+/, "-")
    |> String.trim("-")
  end

  @doc "Builds a catalog agent YAML map from parsed frontmatter and markdown body."
  def build_agent_yaml(frontmatter, body, category) do
    display_name = frontmatter["name"] || ""

    %{
      "name" => slugify(display_name),
      "display_name" => display_name,
      "description" => frontmatter["description"] || "",
      "category" => category,
      "emoji" => frontmatter["emoji"] || "",
      "tags" => [],
      "harness" => "claude_code",
      "model" => "claude-sonnet-4-6",
      "system_prompt" => body
    }
  end
end
