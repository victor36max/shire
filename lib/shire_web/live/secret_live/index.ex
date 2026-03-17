defmodule ShireWeb.SecretLive.Index do
  use ShireWeb, :live_view

  alias Shire.Agents

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, :secrets, Agents.list_global_secrets())}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    secret = Agents.get_secret!(id)
    {:ok, _} = Agents.delete_secret(secret)
    {:noreply, assign(socket, :secrets, Agents.list_global_secrets())}
  end

  def handle_event("edit", %{"id" => id}, socket) do
    {:noreply, assign(socket, :secret, Agents.get_secret!(id))}
  end

  def handle_event("create-secret", %{"secret" => secret_params}, socket) do
    case Agents.create_secret(secret_params) do
      {:ok, _secret} ->
        {:noreply,
         socket
         |> put_flash(:info, "Secret created successfully")
         |> assign(:secrets, Agents.list_global_secrets())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to create secret")}
    end
  end

  def handle_event("update-secret", %{"id" => id, "secret" => secret_params}, socket) do
    secret = Agents.get_secret!(id)

    case Agents.update_secret(secret, secret_params) do
      {:ok, _secret} ->
        {:noreply,
         socket
         |> put_flash(:info, "Secret updated successfully")
         |> assign(:secrets, Agents.list_global_secrets())}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Failed to update secret")}
    end
  end

  defp serialize_secrets(secrets) do
    Enum.map(secrets, fn secret ->
      %{id: secret.id, key: secret.key}
    end)
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SecretList"
      secrets={serialize_secrets(@secrets)}
      socket={@socket}
    />
    """
  end
end
