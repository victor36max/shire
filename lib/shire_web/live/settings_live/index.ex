defmodule ShireWeb.SettingsLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents
  alias ShireWeb.AgentLive.Helpers

  @impl true
  def mount(_params, _session, socket) do
    secrets = Agents.list_global_secrets()
    {messages, has_more} = Agents.list_inter_agent_messages(limit: 100)

    {:ok,
     assign(socket,
       secrets: secrets,
       messages: messages,
       has_more_messages: has_more
     )}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Settings")}
  end

  # Secret CRUD

  @impl true
  def handle_event("create-secret", %{"secret" => secret_params}, socket) do
    case Agents.create_secret(secret_params) do
      {:ok, _secret} ->
        {:noreply, assign(socket, :secrets, Agents.list_global_secrets())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to create secret")}
    end
  end

  @impl true
  def handle_event("update-secret", %{"id" => id, "secret" => secret_params}, socket) do
    secret = Agents.get_secret!(id)

    case Agents.update_secret(secret, secret_params) do
      {:ok, _secret} ->
        {:noreply, assign(socket, :secrets, Agents.list_global_secrets())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to update secret")}
    end
  end

  @impl true
  def handle_event("delete-secret", %{"id" => id}, socket) do
    secret = Agents.get_secret!(id)
    {:ok, _} = Agents.delete_secret(secret)
    {:noreply, assign(socket, :secrets, Agents.list_global_secrets())}
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
      secrets={Helpers.serialize_secrets(@secrets)}
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
