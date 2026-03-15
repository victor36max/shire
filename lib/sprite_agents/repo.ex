defmodule SpriteAgents.Repo do
  use Ecto.Repo,
    otp_app: :sprite_agents,
    adapter: Ecto.Adapters.Postgres
end
