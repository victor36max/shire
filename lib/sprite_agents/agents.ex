defmodule SpriteAgents.Agents do
  import Ecto.Query
  alias SpriteAgents.Repo
  alias SpriteAgents.Agents.{Agent, Message, Secret}

  # Agent CRUD
  def list_agents, do: Repo.all(Agent)
  def get_agent!(id), do: Repo.get!(Agent, id)
  def get_agent_by_name!(name), do: Repo.get_by!(Agent, name: name)
  def create_agent(attrs), do: %Agent{} |> Agent.changeset(attrs) |> Repo.insert()
  def update_agent(%Agent{} = agent, attrs), do: agent |> Agent.changeset(attrs) |> Repo.update()
  def delete_agent(%Agent{} = agent), do: Repo.delete(agent)
  def change_agent(%Agent{} = agent, attrs \\ %{}), do: Agent.changeset(agent, attrs)

  # Secret CRUD
  def list_global_secrets, do: Repo.all(from s in Secret, where: is_nil(s.agent_id))

  def list_secrets_for_agent(agent_id),
    do: Repo.all(from s in Secret, where: s.agent_id == ^agent_id)

  def effective_secrets(agent_id) do
    globals = list_global_secrets()
    agent_secrets = list_secrets_for_agent(agent_id)
    # Agent secrets override globals with same key
    global_map = Map.new(globals, &{&1.key, &1})
    agent_map = Map.new(agent_secrets, &{&1.key, &1})
    Map.merge(global_map, agent_map) |> Map.values()
  end

  def create_secret(attrs), do: %Secret{} |> Secret.changeset(attrs) |> Repo.insert()

  def update_secret(%Secret{} = secret, attrs),
    do: secret |> Secret.changeset(attrs) |> Repo.update()

  def delete_secret(%Secret{} = secret), do: Repo.delete(secret)
  def get_secret!(id), do: Repo.get!(Secret, id)
  def change_secret(%Secret{} = secret, attrs \\ %{}), do: Secret.changeset(secret, attrs)

  # Message CRUD

  def create_message(attrs), do: %Message{} |> Message.changeset(attrs) |> Repo.insert()
  def get_message!(id), do: Repo.get!(Message, id)

  def update_message(%Message{} = message, attrs),
    do: message |> Message.changeset(attrs) |> Repo.update()

  @doc """
  Lists messages for an agent with cursor-based pagination.

  Options:
    - `:before` - message id cursor, fetch messages older than this id
    - `:limit` - page size, default 50

  Returns `{messages, has_more?}` where messages are ordered oldest-first.
  """
  def list_messages_for_agent(agent_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 50)
    before = Keyword.get(opts, :before)

    query =
      from m in Message,
        where: m.agent_id == ^agent_id,
        order_by: [desc: m.id],
        limit: ^limit

    query =
      if before do
        from m in query, where: m.id < ^before
      else
        query
      end

    messages = Repo.all(query)
    has_more = length(messages) == limit

    {Enum.reverse(messages), has_more}
  end

  def delete_messages_for_agent(agent_id) do
    from(m in Message, where: m.agent_id == ^agent_id)
    |> Repo.delete_all()
  end
end
