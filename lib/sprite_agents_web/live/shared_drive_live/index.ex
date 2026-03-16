defmodule SpriteAgentsWeb.SharedDriveLive.Index do
  use SpriteAgentsWeb, :live_view

  alias SpriteAgents.Agent.DriveSync

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(SpriteAgents.PubSub, "shared-drive")
    end

    current_path = "/"

    {:ok,
     socket
     |> assign(:current_path, current_path)
     |> assign(:files, list_files(current_path))}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, socket}
  end

  @impl true
  def handle_event("navigate", %{"path" => path}, socket) do
    {:noreply,
     socket
     |> assign(:current_path, path)
     |> assign(:files, list_files(path))}
  end

  def handle_event("create-directory", %{"name" => name}, socket) do
    path = join_path(socket.assigns.current_path, name)
    DriveSync.create_dir(path)

    {:noreply,
     socket
     |> put_flash(:info, "Directory created")
     |> assign(:files, list_files(socket.assigns.current_path))}
  end

  def handle_event("delete-file", %{"path" => path}, socket) do
    DriveSync.delete_file(path)

    {:noreply,
     socket
     |> assign(:files, list_files(socket.assigns.current_path))}
  end

  def handle_event("delete-directory", %{"path" => path}, socket) do
    DriveSync.delete_dir(path)

    {:noreply,
     socket
     |> assign(:files, list_files(socket.assigns.current_path))}
  end

  def handle_event("upload-file", %{"name" => name, "content" => content}, socket) do
    path = join_path(socket.assigns.current_path, name)

    case Base.decode64(content) do
      {:ok, decoded} ->
        DriveSync.write_file(path, decoded)

        {:noreply,
         socket
         |> put_flash(:info, "File uploaded")
         |> assign(:files, list_files(socket.assigns.current_path))}

      :error ->
        {:noreply, put_flash(socket, :error, "Failed to decode file")}
    end
  end

  @impl true
  def handle_info({:drive_changed, _path, _action}, socket) do
    # Refresh file list on any drive change
    {:noreply, assign(socket, :files, list_files(socket.assigns.current_path))}
  end

  defp list_files(path) do
    case DriveSync.list_files(path) do
      {:ok, files} -> files
      {:error, _} -> []
    end
  catch
    :exit, _ -> []
  end

  defp join_path("/", name), do: name
  defp join_path(base, name), do: "#{String.trim_trailing(base, "/")}/#{name}"

  @impl true
  def render(assigns) do
    ~H"""
    <.react
      name="SharedDrive"
      files={@files}
      current_path={@current_path}
      socket={@socket}
    />
    """
  end
end
