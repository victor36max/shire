defmodule ShireWeb.SharedDriveController do
  use ShireWeb, :controller

  alias Shire.Workspace

  def download(conn, %{"project_name" => project_name, "path" => path}) do
    project = Shire.Projects.get_project_by_name!(project_name)
    vm_path = to_vm_path(project.id, path)

    case vm().read(project.id, vm_path) do
      {:ok, content} ->
        filename = Path.basename(path)
        content_type = MIME.from_path(path)

        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header("content-disposition", ~s(attachment; filename="#{filename}"))
        |> send_resp(200, content)

      {:error, :no_vm} ->
        conn |> put_status(503) |> text("No VM available")

      {:error, _} ->
        conn |> put_status(404) |> text("File not found")
    end
  end

  defp to_vm_path(project_id, path) do
    drive_path = Workspace.shared_dir(project_id)
    clean = path |> String.trim_leading("/") |> String.trim_trailing("/")

    if clean == "" do
      drive_path
    else
      Path.join(drive_path, clean)
    end
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
