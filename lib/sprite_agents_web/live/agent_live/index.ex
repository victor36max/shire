defmodule SpriteAgentsWeb.AgentLive.Index do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Agent

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, :agents, Agents.list_agents())}
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
    {:noreply, push_patch(socket, to: ~p"/agents/#{id}/edit")}
  end

  def handle_event("new-agent", _params, socket) do
    {:noreply, push_patch(socket, to: ~p"/agents/new")}
  end

  @impl true
  def handle_info({SpriteAgentsWeb.AgentLive.FormComponent, {:saved, _agent}}, socket) do
    {:noreply, assign(socket, :agents, Agents.list_agents())}
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

  @impl true
  def render(assigns) do
    ~H"""
    <.header>
      Agents
      <:actions>
        <.button navigate={~p"/secrets"}>Manage Secrets</.button>
        <.button variant="primary" patch={~p"/agents/new"}>New Agent</.button>
      </:actions>
    </.header>

    <.react name="AgentList" agents={serialize_agents(@agents)} socket={@socket} />

    <div
      :if={@live_action in [:new, :edit]}
      id="agent-modal"
      class="modal modal-open"
      phx-click-away={JS.patch(~p"/")}
    >
      <div class="modal-box">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-bold">{@page_title}</h3>
          <.link patch={~p"/"} class="btn btn-sm btn-circle btn-ghost">
            <.icon name="hero-x-mark" />
          </.link>
        </div>
        <.live_component
          module={SpriteAgentsWeb.AgentLive.FormComponent}
          id={@agent.id || :new}
          title={@page_title}
          action={@live_action}
          agent={@agent}
          patch={~p"/"}
        />
      </div>
      <form method="dialog" class="modal-backdrop">
        <.link patch={~p"/"}>close</.link>
      </form>
    </div>
    """
  end
end
