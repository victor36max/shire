defmodule SpriteAgentsWeb.SecretLive.Index do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agents
  alias SpriteAgents.Agents.Secret

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, :secrets, Agents.list_global_secrets())}
  end

  @impl true
  def handle_params(params, _url, socket) do
    {:noreply, apply_action(socket, socket.assigns.live_action, params)}
  end

  defp apply_action(socket, :index, _params) do
    socket
    |> assign(:page_title, "Global Secrets")
    |> assign(:secret, nil)
  end

  defp apply_action(socket, :new, _params) do
    socket
    |> assign(:page_title, "New Secret")
    |> assign(:secret, %Secret{})
  end

  defp apply_action(socket, :edit, %{"id" => id}) do
    socket
    |> assign(:page_title, "Edit Secret")
    |> assign(:secret, Agents.get_secret!(id))
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    secret = Agents.get_secret!(id)
    {:ok, _} = Agents.delete_secret(secret)

    {:noreply, assign(socket, :secrets, Agents.list_global_secrets())}
  end

  def handle_event("validate", %{"secret" => secret_params}, socket) do
    changeset = Agents.change_secret(socket.assigns.secret, secret_params)
    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"secret" => secret_params}, socket) do
    save_secret(socket, socket.assigns.live_action, secret_params)
  end

  defp save_secret(socket, :new, secret_params) do
    case Agents.create_secret(secret_params) do
      {:ok, _secret} ->
        {:noreply,
         socket
         |> put_flash(:info, "Secret created successfully")
         |> push_patch(to: ~p"/secrets")
         |> assign(:secrets, Agents.list_global_secrets())}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_secret(socket, :edit, secret_params) do
    case Agents.update_secret(socket.assigns.secret, secret_params) do
      {:ok, _secret} ->
        {:noreply,
         socket
         |> put_flash(:info, "Secret updated successfully")
         |> push_patch(to: ~p"/secrets")
         |> assign(:secrets, Agents.list_global_secrets())}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  @impl true
  def render(assigns) do
    assigns =
      if assigns[:live_action] in [:new, :edit] and is_nil(assigns[:form]) do
        secret = assigns.secret
        assign(assigns, :form, to_form(Agents.change_secret(secret)))
      else
        assigns
      end

    ~H"""
    <.header>
      Global Secrets
      <:actions>
        <.button navigate={~p"/"}>Back to Agents</.button>
        <.button variant="primary" patch={~p"/secrets/new"}>New Secret</.button>
      </:actions>
    </.header>

    <.table id="secrets" rows={@secrets}>
      <:col :let={secret} label="Key">{secret.key}</:col>
      <:col :let={_secret} label="Value">
        <span class="font-mono text-sm">********</span>
      </:col>
      <:action :let={secret}>
        <.link patch={~p"/secrets/#{secret}/edit"} class="link link-primary">Edit</.link>
      </:action>
      <:action :let={secret}>
        <.link
          phx-click={JS.push("delete", value: %{id: secret.id})}
          data-confirm="Are you sure?"
          class="link link-error"
        >
          Delete
        </.link>
      </:action>
    </.table>

    <div
      :if={@live_action in [:new, :edit]}
      id="secret-modal"
      class="modal modal-open"
      phx-click-away={JS.patch(~p"/secrets")}
    >
      <div class="modal-box">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-bold">{@page_title}</h3>
          <.link patch={~p"/secrets"} class="btn btn-sm btn-circle btn-ghost">
            <.icon name="hero-x-mark" />
          </.link>
        </div>
        <.form for={@form} id="secret-form" phx-change="validate" phx-submit="save">
          <.input field={@form[:key]} type="text" label="Key" />
          <.input field={@form[:value]} type="password" label="Value" />
          <div class="mt-4 flex justify-end gap-2">
            <.link patch={~p"/secrets"} class="btn">Cancel</.link>
            <button type="submit" phx-disable-with="Saving..." class="btn btn-primary">
              Save Secret
            </button>
          </div>
        </.form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <.link patch={~p"/secrets"}>close</.link>
      </form>
    </div>
    """
  end
end
