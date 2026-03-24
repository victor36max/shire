defmodule ShireWeb.SharedDriveController do
  use ShireWeb, :controller

  alias Shire.Workspace

  def download(conn, %{"project_name" => project_name, "path" => path}) do
    serve_file(conn, project_name, path, :attachment)
  end

  def preview(conn, %{"project_name" => project_name, "path" => path}) do
    serve_file(conn, project_name, path, :inline)
  end

  defp serve_file(conn, project_name, path, disposition) do
    project = Shire.Projects.get_project_by_name!(project_name)
    vm_path = to_vm_path(project.id, path)

    case vm().read(project.id, vm_path) do
      {:ok, content} ->
        filename = Path.basename(path)
        content_type = MIME.from_path(path)

        disposition_value =
          case disposition do
            :attachment -> ~s(attachment; filename="#{filename}")
            :inline -> "inline"
          end

        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header("content-disposition", disposition_value)
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
    candidate = if clean == "", do: drive_path, else: Path.join(drive_path, clean)

    expanded = Path.expand(candidate)
    expanded_root = Path.expand(drive_path)

    unless expanded == expanded_root or String.starts_with?(expanded, expanded_root <> "/") do
      raise ArgumentError, "path traversal detected"
    end

    candidate
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
