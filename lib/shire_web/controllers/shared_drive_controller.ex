defmodule ShireWeb.SharedDriveController do
  use ShireWeb, :controller

  alias Shire.Agent.DriveSync

  def download(conn, %{"path" => path}) do
    case DriveSync.read_file(path) do
      {:ok, content} ->
        filename = Path.basename(path)
        content_type = MIME.from_path(path)

        conn
        |> put_resp_content_type(content_type)
        |> put_resp_header(
          "content-disposition",
          ~s(attachment; filename="#{filename}")
        )
        |> send_resp(200, content)

      {:error, _} ->
        conn
        |> put_status(404)
        |> text("File not found")
    end
  end
end
