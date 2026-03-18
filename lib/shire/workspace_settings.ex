defmodule Shire.WorkspaceSettings do
  @moduledoc """
  Manages environment variables and global scripts on the Sprite VM.
  Talks directly to the VM module — no GenServer, no blocking the Coordinator.
  """

  @vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)

  # --- Environment ---

  @doc "Reads `/workspace/.env` from the VM and returns it as a string."
  def read_env do
    case @vm.cmd("bash", ["-c", "test -f /workspace/.env && cat /workspace/.env || echo ''"], []) do
      {:ok, output} -> {:ok, output}
      {:error, _} -> {:ok, ""}
    end
  end

  @doc "Writes the given string to `/workspace/.env` on the VM."
  def write_env(content) do
    case @vm.write("/workspace/.env", content) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Scripts ---

  @doc "Lists script filenames in `/workspace/.scripts/`."
  def list_scripts do
    case @vm.cmd(
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
  def read_all_scripts do
    with {:ok, names} <- list_scripts() do
      scripts =
        Enum.map(names, fn name ->
          content =
            case read_script(name) do
              {:ok, c} -> c
              _ -> ""
            end

          %{name: name, content: content}
        end)

      {:ok, scripts}
    end
  end

  @doc "Reads a script file from `/workspace/.scripts/{name}`."
  def read_script(name) do
    path = "/workspace/.scripts/#{name}"

    case @vm.cmd("bash", ["-c", "test -f #{path} && cat #{path} || echo '__NOT_FOUND__'"], []) do
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
  def write_script(name, content) do
    path = "/workspace/.scripts/#{name}"

    with :ok <- @vm.write(path, content),
         {:ok, _} <- @vm.cmd("chmod", ["+x", path], []) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Deletes a script file from `/workspace/.scripts/{name}`."
  def delete_script(name) do
    path = "/workspace/.scripts/#{name}"
    @vm.cmd("rm", ["-f", path], [])
    :ok
  end

  @doc "Runs a script from `/workspace/.scripts/{name}` and returns output."
  def run_script(name) do
    path = "/workspace/.scripts/#{name}"
    script_cmd = "[ -f /workspace/.env ] && set -a && . /workspace/.env && set +a; bash #{path}"

    case @vm.cmd("bash", ["-c", script_cmd], timeout: 120_000) do
      {:ok, output} -> {:ok, output}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Bootstrap ---

  @doc "Runs the bootstrap script to initialize `/workspace` directories on the VM."
  def bootstrap_workspace do
    script = File.read!(Application.app_dir(:shire, "priv/sprite/bootstrap.sh"))

    case @vm.cmd("bash", ["-c", script], timeout: 120_000) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
