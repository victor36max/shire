defmodule ShireWeb.ProjectLive.Index do
  use ShireWeb, :live_view

  alias Shire.ProjectManager

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(Shire.PubSub, "projects:lobby")
    end

    projects = ProjectManager.list_projects()

    {:ok, assign(socket, projects: projects)}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :page_title, "Projects")}
  end

  @impl true
  def handle_event("create-project", %{"name" => name}, socket) do
    case ProjectManager.create_project(name) do
      {:ok, _pid} ->
        projects = ProjectManager.list_projects()

        {:noreply,
         socket
         |> assign(:projects, projects)
         |> put_flash(:info, "Project created")}

      {:error, :already_exists} ->
        {:noreply, put_flash(socket, :error, "Project already exists")}

      {:error, :no_token} ->
        {:noreply, put_flash(socket, :error, "SPRITES_TOKEN not configured")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to create project: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_event("delete-project", %{"name" => name}, socket) do
    case ProjectManager.destroy_project(name) do
      :ok ->
        projects = ProjectManager.list_projects()

        {:noreply,
         socket
         |> assign(:projects, projects)
         |> put_flash(:info, "Project deleted")}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed to delete: #{inspect(reason)}")}
    end
  end

  @impl true
  def handle_info({:project_created, _name}, socket) do
    projects = ProjectManager.list_projects()
    {:noreply, assign(socket, :projects, projects)}
  end

  @impl true
  def handle_info({:project_destroyed, _name}, socket) do
    projects = ProjectManager.list_projects()
    {:noreply, assign(socket, :projects, projects)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="ProjectDashboard"
      projects={@projects}
      socket={@socket}
    />
    """
  end
end
