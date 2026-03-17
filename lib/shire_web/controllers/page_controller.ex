defmodule ShireWeb.PageController do
  use ShireWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
