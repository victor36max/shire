defmodule ShireWeb.AttachmentControllerTest do
  use ShireWeb.ConnCase, async: false

  import Mox

  alias Shire.Projects

  setup :set_mox_from_context
  setup :verify_on_exit!

  setup do
    stub(Shire.VirtualMachineMock, :workspace_root, fn _p -> "/workspace" end)
    stub(Shire.VirtualMachineMock, :cmd!, fn _p, _cmd, _args, _opts -> "" end)
    stub(Shire.VirtualMachineMock, :mkdir_p, fn _p, _path -> :ok end)
    stub(Shire.VirtualMachineMock, :write, fn _p, _path, _c -> :ok end)
    stub(Shire.VirtualMachineMock, :rm_rf, fn _p, _path -> :ok end)

    {:ok, project} = Projects.create_project("att-test")

    {:ok, agent} =
      Shire.Agents.create_agent_with_vm(project.id, "att-agent", "version: 1\n")

    %{project: project, agent: agent}
  end

  test "downloads attachment file", %{conn: conn, project: project, agent: agent} do
    expect(Shire.VirtualMachineMock, :read, fn _p, path ->
      assert String.contains?(path, "/attachments/abc12345/report.pdf")
      {:ok, "pdf-content"}
    end)

    conn =
      get(
        conn,
        "/projects/#{project.name}/agents/#{agent.id}/attachments/abc12345/report.pdf"
      )

    assert response(conn, 200) == "pdf-content"
    assert get_resp_header(conn, "content-type") |> hd() =~ "application/pdf"

    assert get_resp_header(conn, "content-disposition") |> hd() =~
             ~s(attachment; filename="report.pdf")
  end

  test "returns 404 for missing attachment", %{conn: conn, project: project, agent: agent} do
    expect(Shire.VirtualMachineMock, :read, fn _p, _path ->
      {:error, :not_found}
    end)

    conn =
      get(
        conn,
        "/projects/#{project.name}/agents/#{agent.id}/attachments/abc12345/missing.txt"
      )

    assert response(conn, 404) == "File not found"
  end

  test "returns 400 for path traversal in filename", %{conn: conn, project: project, agent: agent} do
    conn =
      get(
        conn,
        "/projects/#{project.name}/agents/#{agent.id}/attachments/abc12345/..%2F..%2Fetc%2Fpasswd"
      )

    assert response(conn, 400) == "Invalid parameters"
  end

  test "returns 400 for invalid attachment_id with special chars", %{
    conn: conn,
    project: project,
    agent: agent
  } do
    conn =
      get(
        conn,
        "/projects/#{project.name}/agents/#{agent.id}/attachments/invalid!id/file.txt"
      )

    assert response(conn, 400) == "Invalid parameters"
  end
end
