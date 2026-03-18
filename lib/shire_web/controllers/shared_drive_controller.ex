defmodule ShireWeb.SharedDriveController do
  use ShireWeb, :controller

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)
  @drive_path "/workspace/shared"

  def download(conn, %{"path" => path}) do
    case to_vm_path(path) do
      {:ok, vm_path} ->
        case @vm.read(vm_path) do
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

      {:error, :path_traversal} ->
        conn |> put_status(400) |> text("Invalid path")
    end
  end

  defp to_vm_path(path) do
    base = @drive_path

    candidate =
      path
      |> String.trim_leading("/")
      |> String.trim_trailing("/")
      |> then(fn p -> if p == "", do: base, else: Path.join(base, p) end)
      |> Path.expand()

    if candidate == base or String.starts_with?(candidate, base <> "/") do
      {:ok, candidate}
    else
      {:error, :path_traversal}
    end
  end
end
