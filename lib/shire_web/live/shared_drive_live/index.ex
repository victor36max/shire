defmodule ShireWeb.SharedDriveLive.Index do
  use ShireWeb, :live_view

  alias Shire.ProjectManager

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)
  @drive_path "/workspace/shared"

  @impl true
  def mount(%{"project" => project}, _session, socket) do
    case ProjectManager.lookup_coordinator(project) do
      {:error, :not_found} ->
        {:ok, socket |> put_flash(:error, "Project not found") |> redirect(to: ~p"/")}

      {:ok, _pid} ->
        {:ok,
         socket
         |> assign(:project, project)
         |> assign(:current_path, "/")
         |> assign(:files, list_files(project, "/"))}
    end
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("navigate", %{"path" => path}, socket) do
    project = socket.assigns.project

    {:noreply,
     socket
     |> assign(:current_path, path)
     |> assign(:files, list_files(project, path))}
  end

  def handle_event("create-directory", %{"name" => name}, socket) do
    project = socket.assigns.project
    path = join_path(socket.assigns.current_path, name)

    case @vm.mkdir_p(project, to_vm_path(path)) do
      :ok ->
        {:noreply,
         socket
         |> put_flash(:info, "Directory created")
         |> assign(:files, list_files(project, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  def handle_event("delete-file", %{"path" => path}, socket) do
    project = socket.assigns.project

    case @vm.rm(project, to_vm_path(path)) do
      :ok ->
        {:noreply, assign(socket, :files, list_files(project, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  def handle_event("delete-directory", %{"path" => path}, socket) do
    project = socket.assigns.project

    case @vm.rm_rf(project, to_vm_path(path)) do
      :ok ->
        {:noreply, assign(socket, :files, list_files(project, socket.assigns.current_path))}

      {:error, reason} ->
        {:noreply, put_flash(socket, :error, "Failed: #{inspect(reason)}")}
    end
  end

  def handle_event("upload-file", %{"name" => name, "content" => content}, socket) do
    project = socket.assigns.project
    path = join_path(socket.assigns.current_path, name)

    case Base.decode64(content) do
      {:ok, decoded} ->
        vm_path = to_vm_path(path)

        with :ok <- @vm.mkdir_p(project, Path.dirname(vm_path)),
             :ok <- @vm.write(project, vm_path, decoded) do
          {:noreply,
           socket
           |> put_flash(:info, "File uploaded")
           |> assign(:files, list_files(project, socket.assigns.current_path))}
        else
          {:error, reason} ->
            {:noreply, put_flash(socket, :error, "Upload failed: #{inspect(reason)}")}
        end

      :error ->
        {:noreply, put_flash(socket, :error, "Failed to decode file")}
    end
  end

  defp list_files(project, path) do
    vm_path = to_vm_path(path)

    case @vm.ls(project, vm_path) do
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

  defp to_vm_path(path) do
    clean = path |> String.trim_leading("/") |> String.trim_trailing("/")

    if clean == "" do
      @drive_path
    else
      "#{@drive_path}/#{clean}"
    end
  end

  defp join_path("/", name), do: name
  defp join_path(base, name), do: "#{String.trim_trailing(base, "/")}/#{name}"

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
