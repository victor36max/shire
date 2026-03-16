defmodule SpriteAgentsWeb.AgentLive.Index do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     assign(socket,
       agents: Agents.list_agents(),
       base_recipes: Agents.list_base_recipes(),
       agent: nil
     )}
  end

  @impl true
  def handle_params(params, _url, socket) do
    {:noreply, apply_action(socket, socket.assigns.live_action, params)}
  end

  defp apply_action(socket, :index, _params) do
    socket
    |> assign(:page_title, "Agents")
    |> assign(:agent, nil)
  end

  defp apply_action(socket, :new, _params) do
    socket
    |> assign(:page_title, "New Agent")
    |> assign(:agent, %Agent{})
  end

  defp apply_action(socket, :edit, %{"id" => id}) do
    socket
    |> assign(:page_title, "Edit Agent")
    |> assign(:agent, Agents.get_agent!(id))
  end

  @impl true
  def handle_event("delete-agent", %{"id" => id}, socket) do
    agent = Agents.get_agent!(id)
    {:ok, _} = Agents.delete_agent(agent)
    {:noreply, assign(socket, :agents, Agents.list_agents())}
  end

  def handle_event("edit-agent", %{"id" => id}, socket) do
    {:noreply, assign(socket, :agent, Agents.get_agent!(id))}
  end

  def handle_event("create-agent", %{"recipe" => recipe}, socket) do
    case Agents.create_agent(%{recipe: recipe}) do
      {:ok, _agent} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent created successfully")
         |> assign(:agents, Agents.list_agents())}

      {:error, changeset} ->
        error_msg = format_errors(changeset)
        {:noreply, put_flash(socket, :error, error_msg)}
    end
  end

  def handle_event("update-agent", %{"id" => id, "recipe" => recipe}, socket) do
    agent = Agents.get_agent!(id)

    case Agents.update_agent(agent, %{recipe: recipe}) do
      {:ok, _agent} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent updated successfully")
         |> assign(:agents, Agents.list_agents())}

      {:error, changeset} ->
        error_msg = format_errors(changeset)
        {:noreply, put_flash(socket, :error, error_msg)}
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
    |> Enum.map_join(", ", fn {field, msgs} -> "#{field}: #{Enum.join(msgs, ", ")}" end)
  end

  defp serialize_agents(agents), do: Enum.map(agents, &serialize_agent/1)

  defp serialize_agent(nil), do: nil

  defp serialize_agent(agent) do
    base =
      agent
      |> Map.from_struct()
      |> Map.drop([:__meta__, :secrets, :messages])
      |> Map.update(:inserted_at, nil, &to_string/1)
      |> Map.update(:updated_at, nil, &to_string/1)

    # Extract display fields from recipe
    case Agent.parse_recipe(agent) do
      {:ok, parsed} ->
        Map.merge(base, %{
          name: parsed["name"],
          description: parsed["description"],
          harness: parsed["harness"] || "pi",
          model: parsed["model"],
          system_prompt: parsed["system_prompt"],
          scripts: parsed["scripts"] || []
        })

      _ ->
        Map.merge(base, %{name: "invalid recipe", harness: "pi"})
    end
  end

  defp serialize_base_recipes(recipes) do
    Enum.map(recipes, fn recipe ->
      case Agent.parse_recipe(recipe) do
        {:ok, parsed} ->
          %{id: recipe.id, name: parsed["name"], description: parsed["description"]}

        _ ->
          %{id: recipe.id, name: "invalid", description: nil}
      end
    end)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentPage"
      agents={serialize_agents(@agents)}
      editAgent={serialize_agent(@agent)}
      baseRecipes={serialize_base_recipes(@base_recipes)}
      socket={@socket}
    />
    """
  end
end
