defmodule SpriteAgents.Agents.Agent do
  use Ecto.Schema
  import Ecto.Changeset

  @valid_harnesses ~w(pi claude_code)

  schema "agents" do
    field :recipe, :string
    field :is_base, :boolean, default: false

    field :status, Ecto.Enum,
      values: [:created, :starting, :active, :sleeping, :failed, :crashed, :destroyed],
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
end
