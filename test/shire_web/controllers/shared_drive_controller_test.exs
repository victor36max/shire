defmodule ShireWeb.SharedDriveControllerTest do
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

    {:ok, project} = Projects.create_project("drive-test")
    %{project: project}
  end

  describe "download/2" do
    test "returns file with attachment disposition", %{conn: conn, project: project} do
      expect(Shire.VirtualMachineMock, :read, fn _p, path ->
        assert String.ends_with?(path, "/shared/readme.md")
        {:ok, "# Hello"}
      end)

      conn = get(conn, "/projects/#{project.name}/shared/download?path=readme.md")

      assert response(conn, 200) == "# Hello"
      assert get_resp_header(conn, "content-disposition") |> hd() =~ "attachment"
    end

    test "returns 404 for missing file", %{conn: conn, project: project} do
      expect(Shire.VirtualMachineMock, :read, fn _p, _path -> {:error, :not_found} end)

      conn = get(conn, "/projects/#{project.name}/shared/download?path=missing.txt")
      assert response(conn, 404)
    end
  end

  describe "path traversal" do
    test "rejects path with .. in download", %{conn: conn, project: project} do
      assert_raise ArgumentError, "path traversal detected", fn ->
        get(conn, "/projects/#{project.name}/shared/download?path=../../etc/passwd")
      end
    end

    test "rejects path with .. in preview", %{conn: conn, project: project} do
      assert_raise ArgumentError, "path traversal detected", fn ->
        get(conn, "/projects/#{project.name}/shared/preview?path=../agents/secret")
      end
    end
  end

  describe "preview/2" do
    test "returns file with inline disposition", %{conn: conn, project: project} do
      expect(Shire.VirtualMachineMock, :read, fn _p, path ->
        assert String.ends_with?(path, "/shared/image.png")
        {:ok, "png-data"}
      end)

      conn = get(conn, "/projects/#{project.name}/shared/preview?path=image.png")

      assert response(conn, 200) == "png-data"
      assert get_resp_header(conn, "content-disposition") |> hd() == "inline"
      assert get_resp_header(conn, "content-type") |> hd() =~ "image/png"
    end

    test "returns 404 for missing file", %{conn: conn, project: project} do
      expect(Shire.VirtualMachineMock, :read, fn _p, _path -> {:error, :not_found} end)

      conn = get(conn, "/projects/#{project.name}/shared/preview?path=missing.png")
      assert response(conn, 404)
    end

    test "returns 503 when no VM available", %{conn: conn, project: project} do
      expect(Shire.VirtualMachineMock, :read, fn _p, _path -> {:error, :no_vm} end)

      conn = get(conn, "/projects/#{project.name}/shared/preview?path=file.txt")
      assert response(conn, 503)
    end
  end
end
