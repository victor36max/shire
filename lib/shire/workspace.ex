defmodule Shire.Workspace do
  @moduledoc """
  Centralizes workspace path construction for all backends.
  Delegates to the configured VM implementation for the workspace root.
  """

  def root(project_id), do: vm().workspace_root(project_id)
  def agents_dir(project_id), do: Path.join(root(project_id), "agents")
  def agent_dir(project_id, agent_id), do: Path.join(agents_dir(project_id), "#{agent_id}")
  def shared_dir(project_id), do: Path.join(root(project_id), "shared")
  def env_path(project_id), do: Path.join(root(project_id), ".env")
  def scripts_dir(project_id), do: Path.join(root(project_id), ".scripts")
  def script_path(project_id, name), do: Path.join(scripts_dir(project_id), name)
  def runner_dir(project_id), do: Path.join(root(project_id), ".runner")
  def peers_path(project_id), do: Path.join(root(project_id), "peers.yaml")
  def project_doc_path(project_id), do: Path.join(root(project_id), "PROJECT.md")

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineImpl)
end
