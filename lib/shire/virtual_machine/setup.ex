defmodule Shire.VirtualMachine.Setup do
  @moduledoc """
  Shared VM setup logic: deploys runner files and runs bootstrap.sh.

  Called from VM init callbacks (before the GenServer is registered),
  so all operations go through closure-based `ops` rather than the
  GenServer API.

  ## ops map

      %{
        write: fn path, content -> :ok | {:error, reason} end,
        mkdir_p: fn path -> :ok | {:error, reason} end,
        cmd: fn command, args, opts -> {:ok, output} | {:error, reason} end,
        runner_dir: String.t(),
        workspace_root: String.t()
      }
  """

  require Logger

  @top_level_files ["agent-runner.ts", "package.json", "bun.lock"]

  @doc "Deploys runner files and runs bootstrap.sh."
  def run(ops) do
    with :ok <- deploy_runner_files(ops),
         :ok <- run_bootstrap(ops) do
      :ok
    end
  end

  @doc "Deploys agent-runner.ts, package.json, bun.lock, and harness files to the runner dir."
  def deploy_runner_files(ops) do
    source_dir = Application.app_dir(:shire, "priv/sprite")
    runner_dir = ops.runner_dir

    with :ok <- ops.mkdir_p.(runner_dir),
         :ok <- deploy_files(ops, source_dir, runner_dir, @top_level_files),
         :ok <- deploy_harness_files(ops, source_dir, runner_dir) do
      :ok
    end
  end

  @doc "Reads bootstrap.sh from priv and executes it on the VM."
  def run_bootstrap(ops) do
    case File.read(Application.app_dir(:shire, "priv/sprite/bootstrap.sh")) do
      {:ok, script} ->
        case ops.cmd.("bash", ["-c", script, "bash", ops.workspace_root], timeout: 300_000) do
          {:ok, _output} -> :ok
          {:error, _reason} = error -> error
        end

      {:error, reason} ->
        {:error, {:read_bootstrap, reason}}
    end
  end

  defp deploy_files(ops, source_dir, target_dir, files) do
    Enum.reduce_while(files, :ok, fn file, :ok ->
      case File.read(Path.join(source_dir, file)) do
        {:ok, content} ->
          case ops.write.(Path.join(target_dir, file), content) do
            :ok -> {:cont, :ok}
            {:error, _} = error -> {:halt, error}
          end

        {:error, reason} ->
          {:halt, {:error, {:read_source, file, reason}}}
      end
    end)
  end

  defp deploy_harness_files(ops, source_dir, runner_dir) do
    harness_source = Path.join(source_dir, "harness")
    harness_target = Path.join(runner_dir, "harness")

    if File.dir?(harness_source) do
      case File.ls(harness_source) do
        {:ok, entries} ->
          files =
            Enum.filter(entries, fn f ->
              String.ends_with?(f, ".ts") and not String.ends_with?(f, ".test.ts")
            end)

          with :ok <- ops.mkdir_p.(harness_target) do
            deploy_files(ops, harness_source, harness_target, files)
          end

        {:error, reason} ->
          {:error, {:ls_harness, reason}}
      end
    else
      :ok
    end
  end
end
