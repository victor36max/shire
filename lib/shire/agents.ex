defmodule Shire.Agents do
  import Ecto.Query
  require Logger
  alias Ecto.Multi
  alias Shire.Repo
  alias Shire.Agents.{Agent, Message}
  alias Shire.Workspace

  # --- Agent CRUD ---

  @doc """
  Creates an agent record and sets up its workspace on the VM.
  Uses Ecto.Multi to ensure DB and VM operations are atomic.
  """
  def create_agent_with_vm(project_id, name, recipe_yaml, vm \\ nil) do
    vm = vm || vm()

    Multi.new()
    |> Multi.insert(:agent, Agent.changeset(%Agent{}, %{name: name, project_id: project_id}))
    |> Multi.run(:vm_setup, fn _repo, %{agent: agent} ->
      agent_dir = Workspace.agent_dir(project_id, agent.id)

      dirs =
        for subdir <- ["inbox", "outbox", "scripts", "documents", "attachments/outbox"],
            do: Path.join(agent_dir, subdir)

      try do
        vm.cmd!(project_id, "mkdir", ["-p" | dirs], [])

        case vm.write(project_id, Path.join(agent_dir, "recipe.yaml"), recipe_yaml) do
          :ok -> {:ok, agent.id}
          {:error, reason} -> {:error, reason}
        end
      rescue
        e -> {:error, Exception.message(e)}
      end
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{agent: agent}} -> {:ok, agent}
      {:error, :agent, changeset, _} -> {:error, changeset}
      {:error, :vm_setup, reason, _} -> {:error, reason}
    end
  end

  @doc "Renames an agent in the database."
  def rename_agent(%Agent{} = agent, new_name) do
    agent
    |> Agent.changeset(%{name: new_name})
    |> Repo.update()
  end

  @doc """
  Deletes an agent and removes its workspace from the VM.
  Uses Ecto.Multi to ensure DB and VM operations are atomic.
  """
  def delete_agent_with_vm(project_id, %Agent{} = agent, vm \\ nil) do
    vm = vm || vm()

    Multi.new()
    |> Multi.delete(:agent, agent)
    |> Multi.run(:rm_folder, fn _repo, _ ->
      agent_dir = Workspace.agent_dir(project_id, agent.id)

      case vm.rm_rf(project_id, agent_dir) do
        :ok ->
          {:ok, :removed}

        {:error, reason} ->
          Logger.warning("Failed to remove agent directory #{agent_dir}: #{inspect(reason)}")

          {:ok, :cleanup_failed}
      end
    end)
    |> Repo.transaction()
    |> case do
      {:ok, _} -> :ok
      {:error, :agent, changeset, _} -> {:error, changeset}
    end
  end

  def get_agent!(id), do: Repo.get!(Agent, id)

  def get_agent(id) do
    case Repo.get(Agent, id) do
      nil -> {:error, :not_found}
      agent -> {:ok, agent}
    end
  end

  def get_agent_by_name(project_id, name) do
    Repo.get_by(Agent, project_id: project_id, name: name)
  end

  def get_agent_by_name!(project_id, name) do
    Repo.get_by!(Agent, project_id: project_id, name: name)
  end

  def list_agents(project_id) do
    from(a in Agent, where: a.project_id == ^project_id, order_by: [asc: a.name])
    |> Repo.all()
  end

  # --- Message CRUD ---

  def create_message(attrs), do: %Message{} |> Message.changeset(attrs) |> Repo.insert()
  def get_message!(id), do: Repo.get!(Message, id)

  def update_message(%Message{} = message, attrs),
    do: message |> Message.changeset(attrs) |> Repo.update()

  @doc """
  Sends a message: inserts DB record and writes inbox file on VM atomically.
  """
  def send_message_with_inbox(
        project_id,
        agent_id,
        text,
        inbox_path,
        envelope,
        vm \\ nil,
        opts \\ []
      ) do
    vm = vm || vm()
    attachments = Keyword.get(opts, :attachments, [])

    content =
      case attachments do
        [] -> %{"text" => text}
        _ -> %{"text" => text, "attachments" => attachments}
      end

    Multi.new()
    |> Multi.insert(
      :message,
      Message.changeset(%Message{}, %{
        project_id: project_id,
        agent_id: agent_id,
        role: "user",
        content: content
      })
    )
    |> Multi.run(:write_inbox, fn _repo, _changes ->
      case vm.write(project_id, inbox_path, Ymlr.document!(envelope)) do
        :ok -> {:ok, :written}
        {:error, reason} -> {:error, reason}
      end
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{message: msg}} -> {:ok, msg}
      {:error, :message, changeset, _} -> {:error, changeset}
      {:error, :write_inbox, reason, _} -> {:error, reason}
    end
  end

  @doc """
  Lists messages for an agent within a project with cursor-based pagination.

  Options:
    - `:before` - message id cursor, fetch messages older than this id
    - `:limit` - page size, default 50

  Returns `{messages, has_more?}` where messages are ordered oldest-first.
  """
  def list_messages_for_agent(project_id, agent_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 50)
    before = Keyword.get(opts, :before)

    query =
      from m in Message,
        where: m.project_id == ^project_id and m.agent_id == ^agent_id,
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
  Lists inter-agent messages within a project with cursor-based pagination.
  Returns `{messages, has_more?}` where messages are ordered newest-first.
  """
  def list_inter_agent_messages(project_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, 100)
    before = Keyword.get(opts, :before)

    query =
      from m in Message,
        where:
          m.project_id == ^project_id and
            (m.role == "inter_agent" or
               (m.role == "system" and
                  fragment("?->>'trigger' = 'scheduled_task'", m.content))),
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

  @doc """
  Returns a map of `%{agent_id => unread_count}` for all agents in a project.

  `last_read_ids` is a `%{agent_id => last_read_message_id | nil}` map from
  the AgentManager GenServer state.

  Only counts messages with role "agent" (assistant text).
  """
  def unread_counts(project_id, last_read_ids) do
    # Subquery: count unread agent-role messages per agent, using a dynamic
    # WHERE clause that applies each agent's last_read threshold.
    agent_ids =
      from(a in Agent, where: a.project_id == ^project_id, select: a.id) |> Repo.all()

    # Build a single WHERE filter: (agent_id = X AND id > threshold_X) OR ...
    # This lets Postgres count all agents in one grouped query.
    unread_filter =
      Enum.reduce(agent_ids, dynamic(false), fn aid, acc ->
        thr = Map.get(last_read_ids, aid) || 0
        dynamic([m], ^acc or (m.agent_id == ^aid and m.id > ^thr))
      end)

    counts =
      from(m in Message,
        where: m.project_id == ^project_id and m.role == "agent",
        where: ^unread_filter,
        group_by: m.agent_id,
        select: {m.agent_id, count(m.id)}
      )
      |> Repo.all()
      |> Map.new()

    Map.new(agent_ids, fn aid -> {aid, Map.get(counts, aid, 0)} end)
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
