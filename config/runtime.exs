import Config

if config_env() in [:dev, :test] and File.exists?(".env") do
  DotenvParser.load_file(".env")
end

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/shire start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :shire, ShireWeb.Endpoint, server: true
end

config :shire, ShireWeb.Endpoint, http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# VM backend selection: "sprites" (default), "local", "ssh"
vm_type = System.get_env("SHIRE_VM_TYPE", "sprites")
sprites_token = System.get_env("SPRITES_TOKEN")
sprite_vm_prefix = System.get_env("SPRITE_VM_PREFIX")

if config_env() == :prod && vm_type == "sprites" && is_nil(sprites_token) do
  raise "environment variable SPRITES_TOKEN is missing (required when SHIRE_VM_TYPE=sprites)."
end

# Don't connect to real VMs in test — ProjectManager will skip discovery
if config_env() != :test do
  vm_module =
    case vm_type do
      "local" -> Shire.VirtualMachineLocal
      "ssh" -> Shire.VirtualMachineSSH
      _ -> Shire.VirtualMachineSprite
    end

  config :shire, :vm, vm_module
  config :shire, :sprites_token, sprites_token

  if sprite_vm_prefix do
    config :shire, :sprite_vm_prefix, sprite_vm_prefix
  end

  if vm_type == "ssh" do
    if is_nil(System.get_env("SHIRE_SSH_KEY")) and is_nil(System.get_env("SHIRE_SSH_PASSWORD")) do
      raise "Either SHIRE_SSH_KEY or SHIRE_SSH_PASSWORD is required when SHIRE_VM_TYPE=ssh"
    end

    config :shire, :ssh,
      host:
        System.get_env("SHIRE_SSH_HOST") ||
          raise("SHIRE_SSH_HOST is required when SHIRE_VM_TYPE=ssh"),
      port: String.to_integer(System.get_env("SHIRE_SSH_PORT", "22")),
      user:
        System.get_env("SHIRE_SSH_USER") ||
          raise("SHIRE_SSH_USER is required when SHIRE_VM_TYPE=ssh"),
      key: System.get_env("SHIRE_SSH_KEY"),
      password: System.get_env("SHIRE_SSH_PASSWORD"),
      workspace_root:
        System.get_env(
          "SHIRE_SSH_WORKSPACE_ROOT",
          "/home/#{System.get_env("SHIRE_SSH_USER")}/shire/projects"
        )
  end
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :shire, Shire.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :shire, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :shire, ShireWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :shire, ShireWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :shire, ShireWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.

  # ## Configuring the mailer
  #
  # In production you need to configure the mailer to use a different adapter.
  # Here is an example configuration for Mailgun:
  #
  #     config :shire, Shire.Mailer,
  #       adapter: Swoosh.Adapters.Mailgun,
  #       api_key: System.get_env("MAILGUN_API_KEY"),
  #       domain: System.get_env("MAILGUN_DOMAIN")
  #
  # Most non-SMTP adapters require an API client. Swoosh supports Req, Hackney,
  # and Finch out-of-the-box. This configuration is typically done at
  # compile-time in your config/prod.exs:
  #
  #     config :swoosh, :api_client, Swoosh.ApiClient.Req
  #
  # See https://hexdocs.pm/swoosh/Swoosh.html#module-installation for details.
end
