defmodule ShireWeb.SettingsLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents

  @impl true
  def mount(_params, _session, socket) do
    {messages, has_more} = Agents.list_inter_agent_messages(limit: 100)

    {:ok,
     assign(socket,
       messages: messages,
       has_more_messages: has_more
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Settings")}
  end

  # Activity log pagination

  @impl true
  def handle_event("load-more-messages", %{"before" => before}, socket) do
    {new_messages, has_more} = Agents.list_inter_agent_messages(before: before, limit: 100)
    all_messages = socket.assigns.messages ++ new_messages

    {:noreply,
     assign(socket,
       messages: all_messages,
       has_more_messages: has_more
     )}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SettingsPage"
      secrets={[]}
      messages={serialize_inter_agent_messages(@messages)}
      has_more_messages={@has_more_messages}
      socket={@socket}
    />
    """
  end

  defp serialize_inter_agent_messages(messages) do
    Enum.map(messages, fn msg ->
      %{
        id: msg.id,
        from_agent: msg.content["from_agent"],
        to_agent: msg.content["to_agent"],
        text: msg.content["text"],
        ts: msg.inserted_at |> to_string()
      }
    end)
  end
end
