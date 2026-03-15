defmodule SpriteAgentsWeb.AgentLive.FormComponent do
  use SpriteAgentsWeb, :live_component

  alias SpriteAgents.Agents

  @impl true
  def update(%{agent: agent} = assigns, socket) do
    {:ok,
     socket
     |> assign(assigns)
     |> assign_new(:form, fn ->
       to_form(Agents.change_agent(agent))
     end)}
  end

  @impl true
  def handle_event("validate", %{"agent" => agent_params}, socket) do
    changeset = Agents.change_agent(socket.assigns.agent, agent_params)
    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"agent" => agent_params}, socket) do
    save_agent(socket, socket.assigns.action, agent_params)
  end

  defp save_agent(socket, :edit, agent_params) do
    case Agents.update_agent(socket.assigns.agent, agent_params) do
      {:ok, agent} ->
        notify_parent({:saved, agent})

        {:noreply,
         socket
         |> put_flash(:info, "Agent updated successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_agent(socket, :new, agent_params) do
    case Agents.create_agent(agent_params) do
      {:ok, agent} ->
        notify_parent({:saved, agent})

        {:noreply,
         socket
         |> put_flash(:info, "Agent created successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp notify_parent(msg), do: send(self(), {__MODULE__, msg})

  @impl true
  def render(assigns) do
    ~H"""
    <div>
      <.form for={@form} id="agent-form" phx-target={@myself} phx-change="validate" phx-submit="save">
        <.input field={@form[:name]} type="text" label="Name" />
        <.input field={@form[:model]} type="text" label="Model" />
        <.input field={@form[:system_prompt]} type="textarea" label="System Prompt" />
        <div class="mt-4 flex justify-end gap-2">
          <.link patch={@patch} class="btn">Cancel</.link>
          <button type="submit" phx-disable-with="Saving..." class="btn btn-primary">
            Save Agent
          </button>
        </div>
      </.form>
    </div>
    """
  end
end
