defmodule ShireWeb.SettingsLiveTest do
  use ShireWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias Shire.Agents

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
