defmodule Shire.Repo do
  use Ecto.Repo,
    otp_app: :shire,
    adapter:
      if(Application.compile_env(:shire, :db_type) == "sqlite",
        do: Ecto.Adapters.SQLite3,
        else: Ecto.Adapters.Postgres
      )
end
