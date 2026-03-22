defmodule Shire.WorkspaceSettings do
  @moduledoc """
  Manages environment variables and global scripts on a project's Sprite VM.
  All functions take `project_id` as the first parameter.
  """

  alias Shire.Workspace

  # --- Environment ---

  @doc "Reads `.env` from the workspace and returns it as a string."
  def read_env(project_id) do
    case vm().read(project_id, Workspace.env_path(project_id)) do
      {:ok, content} -> {:ok, content}
      {:error, _} -> {:ok, ""}
    end
  end

  @doc "Writes the given string to `.env` in the workspace."
  def write_env(project_id, content) do
    case vm().write(project_id, Workspace.env_path(project_id), content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Scripts ---

  @doc "Lists script filenames in the workspace `.scripts/` directory."
  def list_scripts(project_id) do
    case vm().ls(project_id, Workspace.scripts_dir(project_id)) do
      {:ok, entries} when is_list(entries) ->
        names =
          entries
          |> Enum.map(& &1["name"])
          |> Enum.filter(&String.ends_with?(&1, ".sh"))

        {:ok, names}

      _ ->
        {:ok, []}
    end
  end

  @doc "Lists all scripts with their content from the workspace scripts directory."
  def read_all_scripts(project_id) do
    with {:ok, names} <- list_scripts(project_id) do
      scripts =
        Enum.map(names, fn name ->
          content =
            case read_script(project_id, name) do
              {:ok, c} -> c
              _ -> ""
            end

          %{name: name, content: content}
        end)

      {:ok, scripts}
    end
  end

  @doc "Reads a script file from the workspace `.scripts/{name}`."
  def read_script(project_id, name) do
    path = Workspace.script_path(project_id, name)

    case vm().read(project_id, path) do
      {:ok, content} -> {:ok, content}
      {:error, :enoent} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Writes a script file to the workspace `.scripts/{name}`."
  def write_script(project_id, name, content) do
    path = Workspace.script_path(project_id, name)

    with :ok <- vm().write(project_id, path, content),
         {:ok, _} <- vm().cmd(project_id, "chmod", ["+x", path], []) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Deletes a script file from the workspace `.scripts/{name}`."
  def delete_script(project_id, name) do
    path = Workspace.script_path(project_id, name)

    case vm().rm(project_id, path) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Runs a script from the workspace `.scripts/{name}` and returns output."
  def run_script(project_id, name) do
    path = Workspace.script_path(project_id, name)
    env_path = Workspace.env_path(project_id)
    script_cmd = "[ -f #{env_path} ] && set -a && . #{env_path} && set +a; bash #{path}"

    case vm().cmd(project_id, "bash", ["-c", script_cmd], timeout: 120_000) do
      {:ok, output} -> {:ok, output}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Project Document ---

  @doc "Reads `PROJECT.md` from the workspace."
  def read_project_doc(project_id) do
    case vm().read(project_id, Workspace.project_doc_path(project_id)) do
      {:ok, content} -> {:ok, content}
      {:error, _} -> {:ok, ""}
    end
  end

  @doc "Writes the given string to `PROJECT.md` in the workspace."
  def write_project_doc(project_id, content) do
    case vm().write(project_id, Workspace.project_doc_path(project_id), content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Bootstrap ---

  @doc "Runs the bootstrap script to initialize workspace directories on the VM."
  def bootstrap_workspace(project_id) do
    script = File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))
    root = Workspace.root(project_id)

    case vm().cmd(project_id, "bash", ["-c", script, "bash", root], timeout: 300_000) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp vm, do: Application.get_env(:shire, :vm, Shire.VirtualMachineSprite)
end
