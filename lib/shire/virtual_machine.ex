defmodule Shire.VirtualMachine do
  @moduledoc """
  Behaviour defining the VM interface for all VM operations.
  All project-scoped operations take `project_id` as the first parameter.
  The implementation is resolved at runtime via `Application.get_env(:shire, :vm)`.
  Set `SHIRE_VM_TYPE=local` for local filesystem,
  or `SHIRE_VM_TYPE=sprites` (default) for Sprite VMs.
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
  @callback touch_keepalive(String.t()) :: :ok
  @callback spawn_command(String.t(), binary(), [binary()], keyword()) ::
              {:ok, term()} | {:error, term()}
  @callback write_stdin(term(), binary()) :: :ok | {:error, term()}
  @callback resize(term(), integer(), integer()) :: :ok | {:error, term()}

  # --- Workspace Root ---

  @doc "Returns the absolute workspace root path for a project."
  @callback workspace_root(String.t()) :: String.t()

  # --- VM Status (non-blocking, reads from Registry) ---

  @doc "Returns the current VM status for a project (:starting, :running, :idle, :unreachable, :stopped)."
  @callback vm_status(String.t()) :: :starting | :running | :idle | :unreachable | :stopped

  # --- VM Management (module-level, not per-project) ---

  @doc "Destroys the underlying VM for a project."
  @callback destroy_vm(String.t()) :: :ok | {:error, term()}
end
