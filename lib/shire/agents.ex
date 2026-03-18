defmodule Shire.Agents do
  import Ecto.Query
  alias Shire.Repo
  alias Shire.Agents.Message

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
  def list_messages_for_agent(agent_name, opts \\ []) do
    limit = Keyword.get(opts, :limit, 50)
    before = Keyword.get(opts, :before)

    query =
      from m in Message,
        where: m.agent_name == ^agent_name,
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

  @doc """
  Lists inter-agent messages across all agents with cursor-based pagination.
  Returns `{messages, has_more?}` where messages are ordered newest-first.
  """
  def list_inter_agent_messages(opts \\ []) do
    limit = Keyword.get(opts, :limit, 100)
    before = Keyword.get(opts, :before)

    query =
      from m in Message,
        where: m.role == "inter_agent",
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

    {messages, has_more}
  end

  def rename_agent_messages(old_name, new_name) do
    from(m in Message, where: m.agent_name == ^old_name)
    |> Repo.update_all(set: [agent_name: new_name])
  end

  def delete_messages_for_agent(agent_name) do
    from(m in Message, where: m.agent_name == ^agent_name)
    |> Repo.delete_all()
  end
end
