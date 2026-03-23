defmodule ShireWeb.AttachmentController do
  use ShireWeb, :controller

  alias Shire.Workspace

  def download(conn, %{
        "project_name" => project_name,
        "agent_id" => agent_id,
        "attachment_id" => attachment_id,
        "filename" => filename
      }) do
    with :ok <- validate_id(agent_id),
         :ok <- validate_id(attachment_id),
         :ok <- validate_filename(filename) do
      project = Shire.Projects.get_project_by_name!(project_name)
      vm_path = Workspace.attachment_path(project.id, agent_id, attachment_id, filename)

      case vm().read(project.id, vm_path) do
        {:ok, content} ->
          content_type = MIME.from_path(filename)

          conn
          |> put_resp_content_type(content_type)
          |> put_resp_header(
            "content-disposition",
            ~s(attachment; filename="#{String.replace(filename, "\"", "")}")
          )
          |> send_resp(200, content)

        {:error, :no_vm} ->
          conn |> put_status(503) |> text("No VM available")

        {:error, _} ->
          conn |> put_status(404) |> text("File not found")
      end
    else
      :error ->
        conn |> put_status(400) |> text("Invalid parameters")
    end
  end

  defp validate_id(id), do: if(Regex.match?(~r/\A[a-f0-9\-]+\z/i, id), do: :ok, else: :error)

  defp validate_filename(name) do
    if String.contains?(name, ["../", "/", "\\", "\""]) or name == "" do
      :error
    else
      :ok
    end
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
