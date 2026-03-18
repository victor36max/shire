defmodule ShireWeb.PageControllerTest do
  use ShireWeb.ConnCase, async: false

  import Mox

  setup do
    Mox.set_mox_global()

    stub(Shire.VirtualMachineMock, :cmd, fn _cmd, _args, _opts -> {:ok, ""} end)
    stub(Shire.VirtualMachineMock, :write, fn _path, _content -> :ok end)

    stub(Shire.VirtualMachineMock, :spawn_command, fn _cmd, _args, _opts ->
      {:error, :not_available_in_test}
    end)

    start_supervised!(Shire.Agent.Coordinator)
    Process.sleep(50)
    :ok
  end

  test "GET / renders agent list", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert html_response(conn, 200) =~ "Agents"
  end
end
