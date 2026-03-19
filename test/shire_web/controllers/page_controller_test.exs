defmodule ShireWeb.PageControllerTest do
  use ShireWeb.ConnCase, async: false

  import Mox

  setup do
    Mox.set_mox_global()
    stub(Shire.VirtualMachineMock, :list_vms, fn -> {:ok, []} end)
    start_supervised!(Shire.ProjectManager)
    :ok
  end

  test "GET / renders project dashboard", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert html_response(conn, 200)
  end
end
