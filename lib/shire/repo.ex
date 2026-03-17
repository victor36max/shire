defmodule Shire.Repo do
  use Ecto.Repo,
    otp_app: :shire,
    adapter: Ecto.Adapters.Postgres
end
