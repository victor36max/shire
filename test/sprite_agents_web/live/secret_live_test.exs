defmodule SpriteAgentsWeb.SecretLiveTest do
  use SpriteAgentsWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias SpriteAgents.Agents

  defp create_secret(_) do
    {:ok, secret} = Agents.create_secret(%{key: "TEST_KEY", value: "test_value"})
    %{secret: secret}
  end

  describe "Index" do
    test "renders secret list page", %{conn: conn} do
      {:ok, _view, html} = live(conn, ~p"/secrets")
      assert html =~ "SecretList"
    end

    setup [:create_secret]

    test "displays secrets in serialized props", %{conn: conn, secret: secret} do
      {:ok, _view, html} = live(conn, ~p"/secrets")
      assert html =~ secret.key
    end

    test "creates a new secret via event", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/secrets")

      render_hook(view, "create-secret", %{
        "secret" => %{"key" => "NEW_KEY", "value" => "new_value"}
      })

      html = render(view)
      assert html =~ "NEW_KEY"
    end

    test "updates a secret via event", %{conn: conn, secret: secret} do
      {:ok, view, _html} = live(conn, ~p"/secrets")

      render_hook(view, "update-secret", %{
        "id" => secret.id,
        "secret" => %{"key" => "UPDATED_KEY", "value" => "updated_value"}
      })

      html = render(view)
      assert html =~ "UPDATED_KEY"
    end

    test "deletes a secret via event", %{conn: conn, secret: secret} do
      {:ok, view, _html} = live(conn, ~p"/secrets")

      render_hook(view, "delete", %{"id" => secret.id})

      html = render(view)
      refute html =~ "TEST_KEY"
    end
  end
end
