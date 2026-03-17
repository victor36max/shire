defmodule ShireWeb.SettingsLiveTest do
  use ShireWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias Shire.Agents

  defp create_secret(_) do
    {:ok, secret} = Agents.create_secret(%{key: "TEST_KEY", value: "test_value"})
    %{secret: secret}
  end

  describe "Index" do
    test "renders settings page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/settings")
      assert html =~ "SettingsPage"
    end

    setup [:create_secret]

    test "displays secrets in serialized props", %{conn: conn, secret: secret} do
      {:ok, _view, html} = live(conn, ~p"/settings")
      assert html =~ secret.key
    end

    test "creates a new secret via event", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/settings")

      render_hook(view, "create-secret", %{
        "secret" => %{"key" => "NEW_KEY", "value" => "new_value"}
      })

      html = render(view)
      assert html =~ "NEW_KEY"
    end

    test "updates a secret via event", %{conn: conn, secret: secret} do
      {:ok, view, _html} = live(conn, ~p"/settings")

      render_hook(view, "update-secret", %{
        "id" => secret.id,
        "secret" => %{"key" => "UPDATED_KEY", "value" => "updated_value"}
      })

      html = render(view)
      assert html =~ "UPDATED_KEY"
    end

    test "deletes a secret via event", %{conn: conn, secret: secret} do
      {:ok, view, _html} = live(conn, ~p"/settings")

      render_hook(view, "delete-secret", %{"id" => secret.id})

      html = render(view)
      refute html =~ "TEST_KEY"
    end

    test "loads inter-agent messages", %{conn: conn} do
      {:ok, agent} =
        Agents.create_agent(%{
          recipe: "name: TestAgent\nharness: pi",
          is_base: false,
          status: :created
        })

      {:ok, _msg} =
        Agents.create_message(%{
          agent_id: agent.id,
          role: "inter_agent",
          content: %{
            "text" => "Hello from Alice",
            "from_agent" => "Alice",
            "to_agent" => "TestAgent"
          }
        })

      {:ok, _view, html} = live(conn, ~p"/settings")
      assert html =~ "Hello from Alice"
      assert html =~ "Alice"
    end
  end
end
