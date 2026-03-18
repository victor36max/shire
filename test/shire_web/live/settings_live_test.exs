defmodule ShireWeb.SettingsLiveTest do
  use ShireWeb.ConnCase, async: false

  import Phoenix.LiveViewTest
  import Mox

  alias Shire.Agents

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

  describe "Index" do
    test "renders settings page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/settings")
      assert html =~ "SettingsPage"
    end

    test "loads inter-agent messages", %{conn: conn} do
      {:ok, _msg} =
        Agents.create_message(%{
          agent_name: "test-agent",
          role: "inter_agent",
          content: %{
            "text" => "Hello from Alice",
            "from_agent" => "Alice",
            "to_agent" => "test-agent"
          }
        })

      {:ok, _view, html} = live(conn, ~p"/settings")
      assert html =~ "Hello from Alice"
      assert html =~ "Alice"
    end
  end
end
