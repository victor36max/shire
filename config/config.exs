# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

# Database backend: "sqlite" (default) or "postgres" (set SHIRE_DB=postgres)
db_type = System.get_env("SHIRE_DB", "sqlite")

config :shire,
  db_type: db_type,
  ecto_repos: [Shire.Repo],
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :shire, ShireWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: ShireWeb.ErrorHTML, json: ShireWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Shire.PubSub,
  live_view: [signing_salt: "xg3MntNl"]

# Configure the mailer
#
# By default it uses the "Local" adapter which stores the emails
# locally. You can see the emails in your browser, at "/dev/mailbox".
#
# For production it's recommended to configure a different adapter
# at the `config/runtime.exs`.
config :shire, Shire.Mailer, adapter: Swoosh.Adapters.Local

# Configure tailwind (the version is required)
config :tailwind,
  version: "4.1.12",
  shire: [
    args: ~w(
      --input=assets/css/app.css
      --output=priv/static/assets/css/app.css
    ),
    cd: Path.expand("..", __DIR__)
  ]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Oban job processing (use Lite engine for SQLite)
oban_config = [
  repo: Shire.Repo,
  queues: [scheduled_tasks: 5],
  plugins: [Oban.Plugins.Pruner]
]

oban_config =
  if db_type == "sqlite",
    do: Keyword.put(oban_config, :engine, Oban.Engines.Lite),
    else: oban_config

config :shire, Oban, oban_config

# Sprites client — token configured per-environment
config :shire, :sprites_token, nil

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
