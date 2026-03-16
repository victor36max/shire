defmodule SpriteAgentsWeb.AgentLive.Index do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, agents: Agents.list_agents(), agent: nil)}
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

  def handle_event("create-agent", %{"agent" => agent_params}, socket) do
    case Agents.create_agent(agent_params) do
      {:ok, _agent} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent created successfully")
         |> assign(:agents, Agents.list_agents())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to create agent")}
    end
  end

  def handle_event("update-agent", %{"id" => id, "agent" => agent_params}, socket) do
    agent = Agents.get_agent!(id)

    case Agents.update_agent(agent, agent_params) do
      {:ok, _agent} ->
        {:noreply,
         socket
         |> put_flash(:info, "Agent updated successfully")
         |> assign(:agents, Agents.list_agents())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to update agent")}
    end
  end

  defp serialize_agents(agents) do
    Enum.map(agents, fn agent ->
      agent
      |> Map.from_struct()
      |> Map.drop([:__meta__, :secrets])
      |> Map.update(:inserted_at, nil, &to_string/1)
      |> Map.update(:updated_at, nil, &to_string/1)
    end)
  end

  defp serialize_agent(nil), do: nil

  defp serialize_agent(agent) do
    agent
    |> Map.from_struct()
    |> Map.drop([:__meta__, :secrets])
    |> Map.update(:inserted_at, nil, &to_string/1)
    |> Map.update(:updated_at, nil, &to_string/1)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="AgentPage"
      agents={serialize_agents(@agents)}
      editAgent={serialize_agent(@agent)}
      socket={@socket}
    />
    """
  end
end
