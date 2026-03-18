defmodule Shire.VirtualMachineStub do
  @moduledoc """
  Default stub implementation for Shire.VirtualMachine in tests.
  Returns safe no-op values for all VM operations.
  """
  @behaviour Shire.VirtualMachine

  @impl true
  def cmd(_command, _args \\ [], _opts \\ []), do: {:ok, ""}

  @impl true
  def cmd!(_command, _args \\ [], _opts \\ []), do: ""

  @impl true
  def read(_path), do: {:ok, ""}

  @impl true
  def write(_path, _content), do: :ok

  @impl true
  def mkdir_p(_path), do: :ok

  @impl true
  def rm(_path), do: :ok

  @impl true
  def rm_rf(_path), do: :ok

  @impl true
  def ls(_path), do: {:ok, []}

  @impl true
  def stat(_path), do: {:ok, %{type: :file, size: 0}}

  @impl true
  def spawn_command(_command, _args \\ [], _opts \\ []),
    do: {:error, :not_available_in_test}

  @impl true
  def write_stdin(_command, _data), do: :ok

  @impl true
  def resize(_command, _rows, _cols), do: :ok
end
