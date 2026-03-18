defmodule Shire.VirtualMachine do
  @moduledoc """
  Behaviour defining the VM interface for all Sprite VM operations.
  Consumers use `@vm Application.compile_env(:shire, :vm, Shire.VirtualMachineImpl)`
  to resolve the implementation at compile time.
  """

  @type cmd_result :: {:ok, binary()} | {:error, term()}
  @type fs_result :: :ok | {:error, term()}

  @callback cmd(binary(), [binary()], keyword()) :: cmd_result()
  @callback cmd!(binary(), [binary()], keyword()) :: binary()
  @callback read(binary()) :: cmd_result()
  @callback write(binary(), binary()) :: fs_result()
  @callback mkdir_p(binary()) :: fs_result()
  @callback rm(binary()) :: fs_result()
  @callback rm_rf(binary()) :: fs_result()
  @callback ls(binary()) :: {:ok, [map()]} | {:error, term()}
  @callback stat(binary()) :: {:ok, map()} | {:error, term()}
  @callback spawn_command(binary(), [binary()], keyword()) ::
              {:ok, Sprites.Command.t()} | {:error, term()}
  @callback write_stdin(Sprites.Command.t(), binary()) :: :ok | {:error, term()}
  @callback resize(Sprites.Command.t(), integer(), integer()) :: :ok | {:error, term()}
end
