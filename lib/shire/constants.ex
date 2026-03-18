defmodule Shire.Constants do
  @moduledoc "Application-wide constants"

  def workspace_root, do: "/workspace"
  def agents_dir, do: "/workspace/agents"
  def shared_dir, do: "/workspace/shared"
  def env_file, do: "/workspace/.env"
  def scripts_dir, do: "/workspace/.scripts"

  def outbox_poll_interval, do: 2_000
  def idle_threshold_ms, do: 900_000
  def default_cmd_timeout, do: 30_000
end
