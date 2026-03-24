defmodule ShireWeb.Router do
  use ShireWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {ShireWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", ShireWeb do
    pipe_through :browser

    live_session :default, layout: {ShireWeb.Layouts, :app} do
      live "/", ProjectLive.Index, :index

      live "/projects/:project_name", AgentLive.Index, :index
      live "/projects/:project_name/agents/:agent_name", AgentLive.Show, :show

      live "/projects/:project_name/settings", SettingsLive.Index, :index

      live "/projects/:project_name/details", ProjectDetailsLive.Index, :index

      live "/projects/:project_name/shared", SharedDriveLive.Index, :index

      live "/projects/:project_name/schedules", ScheduleLive.Index, :index
    end
  end

  scope "/", ShireWeb do
    pipe_through :browser

    get "/projects/:project_name/shared/download", SharedDriveController, :download
    get "/projects/:project_name/shared/preview", SharedDriveController, :preview

    get "/projects/:project_name/agents/:agent_id/attachments/:attachment_id/:filename",
        AttachmentController,
        :download
  end

  import Oban.Web.Router

  scope "/" do
    pipe_through :browser

    oban_dashboard("/oban")
  end

  # Other scopes may use custom stacks.
  # scope "/api", ShireWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:shire, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: ShireWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
