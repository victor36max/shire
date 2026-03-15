defmodule SpriteAgentsWeb.PageController do
  use SpriteAgentsWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
