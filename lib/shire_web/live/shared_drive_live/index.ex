defmodule ShireWeb.SharedDriveLive.Index do
  use ShireWeb, :live_view

  alias Shire.Projects
  alias Shire.ProjectManager
  alias Shire.Workspace

  @impl true
  def mount(%{"project_name" => project_name}, _session, socket) do
    project = Projects.get_project_by_name!(project_name)
    project_id = project.id

    case ProjectManager.lookup_coordinator(project_id) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        {:ok,
         socket
         |> assign(:project, %{id: project.id, name: project.name})
         |> assign(:current_path, "/")
         |> assign(:files, list_files(project_id, "/"))}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("navigate", %{"path" => path}, socket) do
    project_id = socket.assigns.project.id

    {:noreply,
     socket
     |> assign(:current_path, path)
     |> assign(:files, list_files(project_id, path))}
  end

  def handle_event("create-directory", %{"name" => name}, socket) do
    project_id = socket.assigns.project.id
    path = join_path(socket.assigns.current_path, name)

    case vm().mkdir_p(project_id, to_vm_path(project_id, path)) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Directory created")
         |> assign(:files, list_files(project_id, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  def handle_event("delete-file", %{"path" => path}, socket) do
    project_id = socket.assigns.project.id

    case vm().rm(project_id, to_vm_path(project_id, path)) do
      :ok ->
        {:noreply, assign(socket, :files, list_files(project_id, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  def handle_event("delete-directory", %{"path" => path}, socket) do
    project_id = socket.assigns.project.id

    case vm().rm_rf(project_id, to_vm_path(project_id, path)) do
      :ok ->
        {:noreply, assign(socket, :files, list_files(project_id, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  @max_preview_size 1_048_576

  def handle_event("preview-file", %{"path" => path}, socket) do
    project_id = socket.assigns.project.id
    vm_path = to_vm_path(project_id, path)

    case vm().read(project_id, vm_path) do
      {:ok, content} when byte_size(content) > @max_preview_size ->
        {:reply, %{error: "File too large to preview"}, socket}

      {:ok, content} ->
        if String.valid?(content) do
          {:reply, %{content: content}, socket}
        else
          {:reply, %{error: "File contains binary data and cannot be previewed as text"}, socket}
        end

      {:error, _} ->
        {:reply, %{error: "Failed to read file"}, socket}
    end
  end

  def handle_event("upload-file", %{"name" => name, "content" => content}, socket) do
    project_id = socket.assigns.project.id
    path = join_path(socket.assigns.current_path, name)

    case Base.decode64(content) do
      {:ok, decoded} ->
        vm_path = to_vm_path(project_id, path)

        with :ok <- vm().mkdir_p(project_id, Path.dirname(vm_path)),
             :ok <- vm().write(project_id, vm_path, decoded) do
          {:noreply,
           socket
           |> put_flash(:info, "File uploaded")
           |> assign(:files, list_files(project_id, socket.assigns.current_path))}
        else
          {:error, reason} ->
            {:noreply, put_flash(socket, :error, "Upload failed: #{inspect(reason)}")}
        end

      :error ->
        {:noreply, put_flash(socket, :error, "Failed to decode file")}
    end
  end

  defp list_files(project_id, path) do
    vm_path = to_vm_path(project_id, path)

    case vm().ls(project_id, vm_path) do
      {:ok, entries} when is_list(entries) ->
        entries
        |> Enum.sort_by(fn entry -> entry["name"] || to_string(entry) end)
        |> Enum.map(fn entry ->
          name = entry["name"] || to_string(entry)
          clean_path = String.trim_leading(path, "/")

          rel_path =
            if clean_path == "" do
              name
            else
              "#{clean_path}/#{name}"
            end

          type = if entry["isDir"], do: "directory", else: "file"
          size = entry["size"] || 0
          %{name: name, path: rel_path, type: type, size: size}
        end)

      {:ok, _} ->
        []

      {:error, _} ->
        []
    end
  end

  defp to_vm_path(project_id, path) do
    drive_path = Workspace.shared_dir(project_id)
    clean = path |> String.trim_leading("/") |> String.trim_trailing("/")
    candidate = if clean == "", do: drive_path, else: Path.join(drive_path, clean)

    expanded = Path.expand(candidate)
    expanded_root = Path.expand(drive_path)

    unless expanded == expanded_root or String.starts_with?(expanded, expanded_root <> "/") do
      raise ArgumentError, "path traversal detected"
    end

    candidate
  end

  defp join_path("/", name), do: name
  defp join_path(base, name), do: "#{String.trim_trailing(base, "/")}/#{name}"

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SharedDrive"
      project={@project}
      files={@files}
      current_path={@current_path}
      socket={@socket}
    />
    """
  end
end
