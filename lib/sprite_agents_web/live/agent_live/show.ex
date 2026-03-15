defmodule SpriteAgentsWeb.AgentLive.Show do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    agent = Agents.get_agent!(id)
    {:ok, assign(socket, :agent, agent)}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Agent: #{socket.assigns.agent.name}")}
  end

  defp status_badge_class(status) do
    case status do
      :active -> "badge-success"
      :starting -> "badge-warning"
      :sleeping -> "badge-info"
      :failed -> "badge-error"
      :destroyed -> "badge-ghost"
      _ -> "badge-neutral"
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.header>
      {@agent.name}
      <:subtitle>
        <span class={["badge", status_badge_class(@agent.status)]}>
          {@agent.status}
        </span>
      </:subtitle>
      <:actions>
        <.button navigate={~p"/"}>Back</.button>
        <.button variant="primary" patch={~p"/agents/#{@agent}/edit"}>Edit</.button>
      </:actions>
    </.header>

    <.list>
      <:item title="Name">{@agent.name}</:item>
      <:item title="Model">{@agent.model || "Not set"}</:item>
      <:item title="Status">{@agent.status}</:item>
      <:item title="System Prompt">
        <pre class="whitespace-pre-wrap text-sm">{@agent.system_prompt || "Not set"}</pre>
      </:item>
    </.list>
    """
  end
end
