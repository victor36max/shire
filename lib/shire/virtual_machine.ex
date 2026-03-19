defmodule Shire.VirtualMachine do
  @moduledoc """
  Behaviour defining the VM interface for all Sprite VM operations.
  All project-scoped operations take `project_name` as the first parameter.
  Consumers use `@vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)`
  to resolve the implementation at compile time.
  """

  @type cmd_result :: {:ok, binary()} | {:error, term()}
  @type fs_result :: :ok | {:error, term()}

  @callback cmd(String.t(), binary(), [binary()], keyword()) :: cmd_result()
  @callback cmd!(String.t(), binary(), [binary()], keyword()) :: binary()
  @callback read(String.t(), binary()) :: cmd_result()
  @callback write(String.t(), binary(), binary()) :: fs_result()
  @callback mkdir_p(String.t(), binary()) :: fs_result()
  @callback rm(String.t(), binary()) :: fs_result()
  @callback rm_rf(String.t(), binary()) :: fs_result()
  @callback ls(String.t(), binary()) :: {:ok, [map()]} | {:error, term()}
  @callback stat(String.t(), binary()) :: {:ok, map()} | {:error, term()}
  @callback spawn_command(String.t(), binary(), [binary()], keyword()) ::
              {:ok, Sprites.Command.t()} | {:error, term()}
  @callback write_stdin(Sprites.Command.t(), binary()) :: :ok | {:error, term()}
  @callback resize(Sprites.Command.t(), integer(), integer()) :: :ok | {:error, term()}

  # --- VM Management (module-level, not per-project) ---

  @doc "Lists all VM names matching the configured prefix."
  @callback list_vms() :: {:ok, [String.t()]} | {:error, term()}

  @doc "Destroys the underlying VM for a project."
  @callback destroy_vm(String.t()) :: :ok | {:error, term()}
end
