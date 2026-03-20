defmodule Shire.WorkspaceSettings do
  @moduledoc """
  Manages environment variables and global scripts on a project's Sprite VM.
  All functions take `project_id` as the first parameter.
  """

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  # --- Environment ---

  @doc "Reads `/workspace/.env` from the VM and returns it as a string."
  def read_env(project_id) do
    case @vm.cmd(
           project_id,
           "bash",
           ["-c", "test -f /workspace/.env && cat /workspace/.env || echo ''"],
           []
         ) do
      {:ok, output} -> {:ok, output}
      {:error, _} -> {:ok, ""}
    end
  end

  @doc "Writes the given string to `/workspace/.env` on the VM."
  def write_env(project_id, content) do
    case @vm.write(project_id, "/workspace/.env", content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Scripts ---

  @doc "Lists script filenames in `/workspace/.scripts/`."
  def list_scripts(project_id) do
    case @vm.cmd(
           project_id,
           "bash",
           ["-c", "test -d /workspace/.scripts && ls /workspace/.scripts || echo ''"],
           []
         ) do
      {:ok, output} ->
        names =
          output
          |> String.split("\n", trim: true)
          |> Enum.filter(&String.ends_with?(&1, ".sh"))

        {:ok, names}

      {:error, _} ->
        {:ok, []}
    end
  end

  @doc "Lists all scripts with their content from `/workspace/.scripts/`."
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

  @doc "Reads a script file from `/workspace/.scripts/{name}`."
  def read_script(project_id, name) do
    path = "/workspace/.scripts/#{name}"

    case @vm.cmd(
           project_id,
           "bash",
           ["-c", "test -f #{path} && cat #{path} || echo '__NOT_FOUND__'"],
           []
         ) do
      {:ok, output} ->
        if String.trim(output) == "__NOT_FOUND__" do
          {:error, :not_found}
        else
          {:ok, output}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Writes a script file to `/workspace/.scripts/{name}`."
  def write_script(project_id, name, content) do
    path = "/workspace/.scripts/#{name}"

    with :ok <- @vm.write(project_id, path, content),
         {:ok, _} <- @vm.cmd(project_id, "chmod", ["+x", path], []) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Deletes a script file from `/workspace/.scripts/{name}`."
  def delete_script(project_id, name) do
    path = "/workspace/.scripts/#{name}"
    @vm.cmd(project_id, "rm", ["-f", path], [])
    :ok
  end

  @doc "Runs a script from `/workspace/.scripts/{name}` and returns output."
  def run_script(project_id, name) do
    path = "/workspace/.scripts/#{name}"
    script_cmd = "[ -f /workspace/.env ] && set -a && . /workspace/.env && set +a; bash #{path}"

    case @vm.cmd(project_id, "bash", ["-c", script_cmd], timeout: 120_000) do
      {:ok, output} -> {:ok, output}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Project Document ---

  @doc "Reads `/workspace/PROJECT.md` from the VM."
  def read_project_doc(project_id) do
    case @vm.read(project_id, "/workspace/PROJECT.md") do
      {:ok, content} -> {:ok, content}
      {:error, _} -> {:ok, ""}
    end
  end

  @doc "Writes the given string to `/workspace/PROJECT.md` on the VM."
  def write_project_doc(project_id, content) do
    case @vm.write(project_id, "/workspace/PROJECT.md", content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Bootstrap ---

  @doc "Runs the bootstrap script to initialize `/workspace` directories on the VM."
  def bootstrap_workspace(project_id) do
    script = File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    case @vm.cmd(project_id, "bash", ["-c", script], timeout: 120_000) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
