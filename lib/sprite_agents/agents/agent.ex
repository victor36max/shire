defmodule SpriteAgents.Agents.Agent do
  use Ecto.Schema
  import Ecto.Changeset

  @valid_harnesses ~w(pi claude_code)

  schema "agents" do
    field :recipe, :string
    field :is_base, :boolean, default: false

    field :status, Ecto.Enum,
      values: [
        :created,
        :starting,
        :bootstrapping,
        :active,
        :sleeping,
        :failed,
        :crashed,
        :destroyed
      ],
      default: :created

    has_many :secrets, SpriteAgents.Agents.Secret
    has_many :messages, SpriteAgents.Agents.Message
    timestamps(type: :utc_datetime)
  end

  def changeset(agent, attrs) do
    agent
    |> cast(attrs, [:recipe, :is_base, :status])
    |> validate_required([:recipe])
    |> validate_recipe()
  end

  def status_changeset(agent, attrs) do
    agent
    |> cast(attrs, [:status])
  end

  # --- Recipe helpers ---

  def parse_recipe(%__MODULE__{recipe: recipe}) when is_binary(recipe) do
    case YamlElixir.read_from_string(recipe) do
      {:ok, parsed} -> {:ok, parsed}
      {:error, _} = err -> err
    end
  end

  def parse_recipe!(%__MODULE__{} = agent) do
    {:ok, parsed} = parse_recipe(agent)
    parsed
  end

  def recipe_name(agent), do: recipe_field(agent, "name")
  def recipe_field(agent, field), do: parse_recipe!(agent)[field]

  # --- Private ---

  defp validate_recipe(changeset) do
    validate_change(changeset, :recipe, fn :recipe, yaml ->
      case YamlElixir.read_from_string(yaml) do
        {:ok, parsed} when is_map(parsed) ->
          []
          |> validate_recipe_name(parsed)
          |> validate_recipe_harness(parsed)
          |> validate_recipe_scripts(parsed)
          |> validate_recipe_skills(parsed)

        {:ok, _} ->
          [recipe: "must be a YAML mapping"]

        {:error, _} ->
          [recipe: "is not valid YAML"]
      end
    end)
  end

  defp validate_recipe_name(errors, parsed) do
    case parsed["name"] do
      name when is_binary(name) and name != "" -> errors
      _ -> [{:recipe, "must include a 'name' field"} | errors]
    end
  end

  defp validate_recipe_harness(errors, parsed) do
    case parsed["harness"] do
      nil -> errors
      h when h in @valid_harnesses -> errors
      _ -> [{:recipe, "harness must be 'pi' or 'claude_code'"} | errors]
    end
  end

  defp validate_recipe_scripts(errors, parsed) do
    case parsed["scripts"] do
      nil ->
        errors

      scripts when is_list(scripts) ->
        errors
        |> validate_script_entries(scripts)
        |> validate_script_names_unique(scripts)

      _ ->
        [{:recipe, "scripts must be a list"} | errors]
    end
  end

  defp validate_script_entries(errors, scripts) do
    Enum.reduce(scripts, errors, fn
      %{"name" => n, "run" => r}, acc when is_binary(n) and is_binary(r) -> acc
      _, acc -> [{:recipe, "each script must have 'name' and 'run' string fields"} | acc]
    end)
  end

  defp validate_script_names_unique(errors, scripts) do
    names = for %{"name" => n} <- scripts, do: n

    if length(names) == length(Enum.uniq(names)) do
      errors
    else
      [{:recipe, "script names must be unique"} | errors]
    end
  end

  # --- Skill validation ---

  @skill_name_format ~r/^[a-z0-9][a-z0-9-]*$/

  defp validate_recipe_skills(errors, parsed) do
    case parsed["skills"] do
      nil ->
        errors

      skills when is_list(skills) ->
        errors
        |> validate_skill_entries(skills)
        |> validate_skill_names_format(skills)
        |> validate_skill_names_unique(skills)
        |> validate_skill_references(skills)

      _ ->
        [{:recipe, "skills must be a list"} | errors]
    end
  end

  defp validate_skill_entries(errors, skills) do
    Enum.reduce(skills, errors, fn
      %{"name" => n, "description" => d, "content" => c}, acc
      when is_binary(n) and n != "" and is_binary(d) and d != "" and is_binary(c) and c != "" ->
        acc

      _, acc ->
        [
          {:recipe, "each skill must have 'name', 'description', and 'content' string fields"}
          | acc
        ]
    end)
  end

  defp validate_skill_names_format(errors, skills) do
    Enum.reduce(skills, errors, fn
      %{"name" => name}, acc ->
        if Regex.match?(@skill_name_format, name) do
          acc
        else
          [{:recipe, "skill name '#{name}' must be lowercase alphanumeric with hyphens"} | acc]
        end

      _, acc ->
        acc
    end)
  end

  defp validate_skill_names_unique(errors, skills) do
    names = for %{"name" => n} <- skills, do: n

    if length(names) == length(Enum.uniq(names)) do
      errors
    else
      [{:recipe, "skill names must be unique"} | errors]
    end
  end

  @reference_name_format ~r/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

  defp validate_skill_references(errors, skills) do
    Enum.reduce(skills, errors, fn
      %{"references" => refs}, acc when is_list(refs) ->
        acc
        |> validate_reference_entries(refs)
        |> validate_reference_names_format(refs)
        |> validate_reference_names_unique(refs)

      %{"references" => _}, acc ->
        [{:recipe, "skill references must be a list"} | acc]

      _, acc ->
        acc
    end)
  end

  defp validate_reference_entries(errors, refs) do
    Enum.reduce(refs, errors, fn
      %{"name" => n, "content" => c}, acc when is_binary(n) and n != "" and is_binary(c) ->
        acc

      _, acc ->
        [{:recipe, "each skill reference must have 'name' and 'content' string fields"} | acc]
    end)
  end

  defp validate_reference_names_format(errors, refs) do
    Enum.reduce(refs, errors, fn
      %{"name" => name}, acc ->
        if Regex.match?(@reference_name_format, name) do
          acc
        else
          [
            {:recipe,
             "reference name '#{name}' must be a safe filename (alphanumeric, dots, hyphens, underscores)"}
            | acc
          ]
        end

      _, acc ->
        acc
    end)
  end

  defp validate_reference_names_unique(errors, refs) do
    names = for %{"name" => n} <- refs, do: n

    if length(names) == length(Enum.uniq(names)) do
      errors
    else
      [{:recipe, "skill reference names must be unique within a skill"} | errors]
    end
  end
end
