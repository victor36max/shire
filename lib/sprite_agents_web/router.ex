defmodule SpriteAgentsWeb.Router do
  use SpriteAgentsWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {SpriteAgentsWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", SpriteAgentsWeb do
    pipe_through :browser

    live_session :default, layout: {SpriteAgentsWeb.Layouts, :app} do
      live "/", AgentLive.Index, :index
      live "/agents/new", AgentLive.Index, :new
      live "/agents/:id/edit", AgentLive.Index, :edit
      live "/agents/:id", AgentLive.Show, :show

      live "/secrets", SecretLive.Index, :index
      live "/secrets/new", SecretLive.Index, :new
      live "/secrets/:id/edit", SecretLive.Index, :edit

      live "/shared", SharedDriveLive.Index, :index
    end
  end

  scope "/", SpriteAgentsWeb do
    pipe_through :browser

    get "/shared/download", SharedDriveController, :download
  end

  # Other scopes may use custom stacks.
  # scope "/api", SpriteAgentsWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:sprite_agents, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: SpriteAgentsWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
