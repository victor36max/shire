defmodule Shire.Repo do
  use Ecto.Repo,
    otp_app: :shire,
    adapter:
      if(Application.compile_env(:shire, :db_type) == "sqlite",
        do: Ecto.Adapters.SQLite3,
        else: Ecto.Adapters.Postgres
      )

  @impl true
  def init(_type, config) do
    if db_path = config[:database] do
      File.mkdir_p!(Path.dirname(db_path))
    end

    {:ok, config}
  end
end
