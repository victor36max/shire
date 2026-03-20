defmodule ShireWeb.ProjectDetailsLive.Index do
  use ShireWeb, :live_view

  alias Shire.Projects
  alias Shire.ProjectManager
  alias Shire.Slug
  alias Shire.WorkspaceSettings

  @impl true
  def mount(%{"project_name" => project_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)

    case ProjectManager.lookup_coordinator(project.id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        project_doc =
          case WorkspaceSettings.read_project_doc(project.id) do
            {:ok, content} -> content
            _ -> ""
          end

        {:ok,
         assign(socket,
           project: %{id: project.id, name: project.name},
           project_doc: project_doc
         )}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Project Details")}
  end

  @impl true
  def handle_event("save-project-doc", %{"content" => content}, socket) do
    case WorkspaceSettings.write_project_doc(socket.assigns.project.id, content) do
      :ok ->
        {:noreply,
         socket
         |> assign(:project_doc, content)
         |> put_flash(:info, "Project document saved")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to save: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("rename-project", %{"name" => new_name}, socket) do
    project = Projects.get_project!(socket.assigns.project.id)

    if Slug.valid?(new_name) do
      case Projects.rename_project(project, new_name) do
        {:ok, updated} ->
          {:noreply,
           socket
           |> put_flash(:info, "Project renamed to #{updated.name}")
           |> redirect(to: ~p"/projects/#{updated.name}/details")}

        {:error, _changeset} ->
          {:noreply, put_flash(socket, :error, "Failed to rename. Name may already be taken.")}
      end
    else
      {:noreply,
       put_flash(
         socket,
         :error,
         "Invalid name. Use lowercase letters, numbers, and hyphens (2-63 chars)."
       )}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="ProjectDetailsPage"
      project={@project}
      project_doc={@project_doc}
      socket={@socket}
    />
    """
  end
end
