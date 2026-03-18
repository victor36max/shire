defmodule ShireWeb.SharedDriveController do
  use ShireWeb, :controller

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)
  @drive_path "/workspace/shared"

  def download(conn, %{"path" => path}) do
    vm_path = to_vm_path(path)

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
  end

  defp to_vm_path(path) do
    clean = path |> String.trim_leading("/") |> String.trim_trailing("/")

    if clean == "" do
      @drive_path
    else
      "#{@drive_path}/#{clean}"
    end
  end
end
