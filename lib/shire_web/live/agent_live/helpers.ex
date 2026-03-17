defmodule ShireWeb.AgentLive.Helpers do
  @moduledoc """
  Shared serialization helpers for AgentLive views.
  """

  alias Shire.Agents
  alias Shire.Agents.Agent

  def serialize_agents(agents, busy_agents \\ MapSet.new(), statuses \\ %{}),
    do: Enum.map(agents, &serialize_agent(&1, busy_agents, statuses))

  def serialize_agent(agent, busy_agents \\ MapSet.new(), statuses \\ %{})

  def serialize_agent(nil, _busy_agents, _statuses), do: nil

  def serialize_agent(agent, busy_agents, statuses) do
    status = Map.get(statuses, agent.id, :created)

    base =
      agent
      |> Map.from_struct()
      |> Map.drop([:__meta__, :secrets, :messages])
      |> Map.put(:status, status)
      |> Map.update(:inserted_at, nil, &to_string/1)
      |> Map.update(:updated_at, nil, &to_string/1)

    busy = MapSet.member?(busy_agents, agent.id)

    case Agent.parse_recipe(agent) do
      {:ok, parsed} ->
        Map.merge(base, %{
          name: parsed["name"],
          description: parsed["description"],
          harness: parsed["harness"] || "claude_code",
          model: parsed["model"],
          system_prompt: parsed["system_prompt"],
          scripts: parsed["scripts"] || [],
          busy: busy
        })

      _ ->
        Map.merge(base, %{name: "invalid recipe", harness: "claude_code", busy: busy})
    end
  end

  def serialize_message(%Agents.Message{} = msg) do
    base = %{id: msg.id, role: msg.role, ts: msg.inserted_at |> to_string()}

    case msg.role do
      "tool_use" ->
        Map.merge(base, %{
          tool: msg.content["tool"],
          tool_use_id: msg.content["tool_use_id"],
          input: msg.content["input"],
          output: msg.content["output"],
          is_error: msg.content["is_error"] || false
        })

      _ ->
        Map.put(base, :text, msg.content["text"])
    end
  end

  def serialize_secrets(secrets), do: Enum.map(secrets, &serialize_secret/1)

  def serialize_secret(secret), do: %{id: secret.id, key: secret.key}

  def serialize_base_recipes(recipes) do
    Enum.map(recipes, fn recipe ->
      case Agent.parse_recipe(recipe) do
        {:ok, parsed} ->
          %{id: recipe.id, name: parsed["name"], description: parsed["description"]}

        _ ->
          %{id: recipe.id, name: "invalid", description: nil}
      end
    end)
  end
end
