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

  def attachments_dir(project_id, agent_id),
    do: Path.join(agent_dir(project_id, agent_id), "attachments")

  def attachment_dir(project_id, agent_id, attachment_id),
    do: Path.join(attachments_dir(project_id, agent_id), attachment_id)

  def attachment_path(project_id, agent_id, attachment_id, filename),
    do: Path.join(attachment_dir(project_id, agent_id, attachment_id), filename)

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
