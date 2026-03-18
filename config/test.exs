import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :shire, Shire.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "shire_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :shire, ShireWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "bmbNeGsU6U/ZQcVkHqWbIY2BCLllqLmb0uZEuWqopdfdTsu2o9VoHcuDTkJM5f3A",
  server: false

# In test we don't send emails
config :shire, Shire.Mailer, adapter: Swoosh.Adapters.Test

# Disable swoosh api client as it is only required for production adapters
config :swoosh, :api_client, false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true

# Use mock VM in tests, skip auto-boot of VM + Coordinator
config :shire, :vm, Shire.VirtualMachineMock
config :shire, :skip_vm_boot, true

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
