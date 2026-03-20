defmodule Shire.VirtualMachineStub do
  @moduledoc """
  Default stub implementation for Shire.VirtualMachine in tests.
  Returns safe no-op values for all VM operations.
  """
  @behaviour Shire.VirtualMachine

  @impl true
  def cmd(_project_id, _command, _args \\ [], _opts \\ []), do: {:ok, ""}

  @impl true
  def cmd!(_project_id, _command, _args \\ [], _opts \\ []), do: ""

  @impl true
  def read(_project_id, _path), do: {:ok, ""}

  @impl true
  def write(_project_id, _path, _content), do: :ok

  @impl true
  def mkdir_p(_project_id, _path), do: :ok

  @impl true
  def rm(_project_id, _path), do: :ok

  @impl true
  def rm_rf(_project_id, _path), do: :ok

  @impl true
  def ls(_project_id, _path), do: {:ok, []}

  @impl true
  def stat(_project_id, _path), do: {:ok, %{type: :file, size: 0}}

  @impl true
  def touch_keepalive(_project_id), do: :ok

  @impl true
  def spawn_command(_project_id, _command, _args \\ [], _opts \\ []),
    do: {:error, :not_available_in_test}

  @impl true
  def write_stdin(_command, _data), do: :ok

  @impl true
  def resize(_command, _rows, _cols), do: :ok

  @impl true
  def destroy_vm(_project_id), do: :ok
end
