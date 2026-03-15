defmodule SpriteAgentsWeb.PageControllerTest do
  use SpriteAgentsWeb.ConnCase

  test "GET / renders agent list", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert html_response(conn, 200) =~ "Agents"
  end
end
