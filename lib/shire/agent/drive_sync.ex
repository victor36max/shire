defmodule Shire.Agent.DriveSync do
  @moduledoc """
  Singleton GenServer managing the shared drive Sprite and file synchronization.
  The shared drive is a dedicated Sprite VM that holds files. This module relays
  file changes between agent VMs and the drive Sprite.
  """
  use GenServer
  require Logger

  alias Shire.Agent.SpriteHelpers

  @sprite_prefix Application.compile_env(:shire, :sprite_prefix, "agent")
  @drive_name Application.compile_env(
                :shire,
                :shared_drive_name,
                "#{@sprite_prefix}-shared-drive"
              )
  @drive_root "/drive"

  defstruct [
    :sprites_client,
    :sprite,
    :drive_fs,
    enabled: false
  ]

  # --- Public API ---

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Ensure the shared drive Sprite exists and is ready."
  def ensure_started do
    GenServer.call(__MODULE__, :ensure_started, 30_000)
  end

  @doc "Handle a file write from an agent — write to drive and fan out."
  def file_changed(agent_id, path, content) do
    GenServer.cast(__MODULE__, {:file_changed, agent_id, path, content})
  end

  @doc "Handle a file deletion from an agent — delete from drive and fan out."
  def file_deleted(agent_id, path) do
    GenServer.cast(__MODULE__, {:file_deleted, agent_id, path})
  end

  @doc "Push all drive files to an agent during bootstrap."
  def sync_to_agent(agent_id, sprite) do
    GenServer.call(__MODULE__, {:sync_to_agent, agent_id, sprite}, 60_000)
  end

  @doc "List files in a directory on the drive (single level). Returns list of maps."
  def list_files(path \\ "/") do
    GenServer.call(__MODULE__, {:list_files, path}, 60_000)
  end

  @doc "Read a file from the drive."
  def read_file(path) do
    GenServer.call(__MODULE__, {:read_file, path}, 60_000)
  end

  @doc "Write a file to the drive from the UI (not from an agent). Fans out to all agents."
  def write_file(path, content) do
    GenServer.cast(__MODULE__, {:write_file, path, content})
  end

  @doc "Create a directory on the drive. Fans out to all agents."
  def create_dir(path) do
    GenServer.cast(__MODULE__, {:create_dir, path})
  end

  @doc "Delete a file from the drive. Fans out to all agents."
  def delete_file(path) do
    GenServer.cast(__MODULE__, {:delete_file, path})
  end

  @doc "Delete a directory recursively from the drive. Fans out to all agents."
  def delete_dir(path) do
    GenServer.cast(__MODULE__, {:delete_dir, path})
  end

  # --- Callbacks ---

  @impl true
  def init(_opts) do
    token = Application.get_env(:shire, :sprites_token)

    if is_nil(token) do
      Logger.info("DriveSync starting in degraded mode (no sprites token)")
      {:ok, %__MODULE__{enabled: false}}
    else
      client = Sprites.new(token)
      {:ok, %__MODULE__{sprites_client: client, enabled: true}, {:continue, :init_sprite}}
    end
  end

  @impl true
  def handle_continue(:init_sprite, state) do
    case get_or_create_sprite(state.sprites_client, @drive_name) do
      {:ok, sprite} ->
        Sprites.cmd(sprite, "mkdir", ["-p", @drive_root])
        drive_fs = SpriteHelpers.filesystem(sprite)
        Logger.info("Shared drive Sprite ready: #{@drive_name}")
        {:noreply, %{state | sprite: sprite, drive_fs: drive_fs}}

      {:error, reason} ->
        Logger.error(
          "Failed to create shared drive Sprite on init: #{inspect(reason)}, retrying in 10s"
        )

        Process.send_after(self(), :retry_init, 10_000)
        {:noreply, state}
    end
  rescue
    e ->
      Logger.error("DriveSync init_sprite crashed: #{inspect(e)}, retrying in 10s")
      Process.send_after(self(), :retry_init, 10_000)
      {:noreply, state}
  end

  @impl true
  def handle_info(:retry_init, %{sprite: nil, enabled: true} = state) do
    {:noreply, state, {:continue, :init_sprite}}
  end

  def handle_info(:retry_init, state) do
    {:noreply, state}
  end

  @impl true
  def handle_call(:ensure_started, _from, %{enabled: false} = state) do
    {:reply, {:error, :no_sprites}, state}
  end

  def handle_call(:ensure_started, _from, %{sprite: sprite} = state) when not is_nil(sprite) do
    {:reply, :ok, state}
  end

  def handle_call(:ensure_started, _from, state) do
    case init_sprite(state) do
      {:ok, new_state} ->
        {:reply, :ok, new_state}

      {:error, reason} ->
        Logger.error("Failed to start shared drive Sprite: #{inspect(reason)}")
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:sync_to_agent, _agent_id, _agent_sprite}, _from, %{enabled: false} = state) do
    {:reply, :ok, state}
  end

  def handle_call({:sync_to_agent, _agent_id, _agent_sprite}, _from, %{sprite: nil} = state) do
    {:reply, {:error, :drive_not_started}, state}
  end

  def handle_call({:sync_to_agent, _agent_id, nil}, _from, state) do
    {:reply, {:error, :invalid_sprite}, state}
  end

  def handle_call({:sync_to_agent, agent_id, agent_sprite}, _from, state) do
    marker_path = "#{@drive_root}/.sync-meta/#{agent_id}"

    files_result =
      case Sprites.cmd(state.sprite, "test", ["-f", marker_path]) do
        {_, 0} -> list_drive_files_since(state.sprite, marker_path)
        _ -> list_drive_files_recursive(state.sprite)
      end

    case files_result do
      {:ok, files} ->
        agent_fs = SpriteHelpers.filesystem(agent_sprite)

        files
        |> Task.async_stream(
          fn relative_path ->
            drive_path = "#{@drive_root}/#{relative_path}"

            case Sprites.Filesystem.read(state.drive_fs, drive_path) do
              {:ok, content} ->
                shared_path = "/workspace/shared/#{relative_path}"
                Sprites.Filesystem.write(agent_fs, shared_path, content)

              {:error, reason} ->
                Logger.warning("Failed to read #{drive_path} from drive: #{inspect(reason)}")
            end
          end,
          max_concurrency: 5,
          timeout: 30_000
        )
        |> Stream.run()

        # Touch marker after successful sync
        Sprites.cmd(state.sprite, "mkdir", ["-p", "#{@drive_root}/.sync-meta"])
        Sprites.cmd(state.sprite, "touch", [marker_path])

        Logger.info("Synced #{length(files)} files to agent #{agent_id}")
        {:reply, :ok, state}

      {:error, reason} ->
        Logger.warning("Failed to list drive files for sync: #{inspect(reason)}")
        {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_call({:list_files, _path}, _from, %{enabled: false} = state) do
    {:reply, {:ok, []}, state}
  end

  def handle_call({:list_files, _path}, _from, %{sprite: nil} = state) do
    {:reply, {:ok, []}, state}
  end

  def handle_call({:list_files, path}, _from, state) do
    drive_path = normalize_drive_path(path)

    case Sprites.cmd(state.sprite, "ls", ["-la", "--time-style=+%s", drive_path]) do
      {output, 0} ->
        files = parse_ls_output(output, path)
        {:reply, {:ok, files}, state}

      {_, _} ->
        {:reply, {:ok, []}, state}
    end
  rescue
    e ->
      Logger.error("DriveSync list_files failed: #{inspect(e)}")
      {:reply, {:ok, []}, state}
  end

  @impl true
  def handle_call({:read_file, _path}, _from, %{enabled: false} = state) do
    {:reply, {:error, :no_sprites}, state}
  end

  def handle_call({:read_file, _path}, _from, %{sprite: nil} = state) do
    {:reply, {:error, :drive_not_started}, state}
  end

  def handle_call({:read_file, path}, _from, state) do
    drive_path = normalize_drive_path(path)

    case Sprites.Filesystem.read(state.drive_fs, drive_path) do
      {:ok, content} -> {:reply, {:ok, content}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  rescue
    e ->
      Logger.error("DriveSync read_file failed: #{inspect(e)}")
      {:reply, {:error, :timeout}, state}
  end

  # --- Private helpers (used by handle_call) ---

  defp init_sprite(state) do
    with {:ok, sprite} <- get_or_create_sprite(state.sprites_client, @drive_name) do
      Sprites.cmd(sprite, "mkdir", ["-p", @drive_root])
      drive_fs = SpriteHelpers.filesystem(sprite)
      Logger.info("Shared drive Sprite ready: #{@drive_name}")
      {:ok, %{state | sprite: sprite, drive_fs: drive_fs}}
    end
  rescue
    e ->
      {:error, e}
  end

  # --- Casts ---

  @impl true
  def handle_cast(_msg, %{enabled: false} = state) do
    {:noreply, state}
  end

  def handle_cast(_msg, %{sprite: nil} = state) do
    {:noreply, state}
  end

  def handle_cast({:file_changed, agent_id, path, content}, state) do
    drive_path = normalize_drive_path(path)

    case Sprites.Filesystem.write(state.drive_fs, drive_path, content) do
      :ok ->
        fan_out_write(agent_id, path, content)
        broadcast_change(path, :write)

      {:error, reason} ->
        Logger.warning("Failed to write #{path} to drive: #{inspect(reason)}")
    end

    {:noreply, state}
  end

  def handle_cast({:file_deleted, agent_id, path}, state) do
    drive_path = normalize_drive_path(path)
    Sprites.cmd(state.sprite, "rm", ["-f", drive_path])
    fan_out_delete(agent_id, path)
    broadcast_change(path, :delete)
    {:noreply, state}
  end

  def handle_cast({:write_file, path, content}, state) do
    drive_path = normalize_drive_path(path)

    case Sprites.Filesystem.write(state.drive_fs, drive_path, content) do
      :ok ->
        fan_out_write(nil, path, content)
        broadcast_change(path, :write)

      {:error, reason} ->
        Logger.warning("Failed to write #{path} to drive: #{inspect(reason)}")
    end

    {:noreply, state}
  end

  def handle_cast({:create_dir, path}, state) do
    drive_path = normalize_drive_path(path)
    Sprites.cmd(state.sprite, "mkdir", ["-p", drive_path])

    # Fan out directory creation to all agents
    running_agents()
    |> Enum.each(fn {agent_id, _pid} ->
      GenServer.cast(
        {:via, Registry, {Shire.AgentRegistry, agent_id}},
        {:drive_create_dir, path}
      )
    end)

    broadcast_change(path, :write)
    {:noreply, state}
  end

  def handle_cast({:delete_file, path}, state) do
    drive_path = normalize_drive_path(path)
    Sprites.cmd(state.sprite, "rm", ["-f", drive_path])
    fan_out_delete(nil, path)
    broadcast_change(path, :delete)
    {:noreply, state}
  end

  def handle_cast({:delete_dir, path}, state) do
    drive_path = normalize_drive_path(path)
    Sprites.cmd(state.sprite, "rm", ["-rf", drive_path])

    # Fan out recursive delete to all agents
    running_agents()
    |> Enum.each(fn {agent_id, _pid} ->
      GenServer.cast(
        {:via, Registry, {Shire.AgentRegistry, agent_id}},
        {:drive_delete_dir, path}
      )
    end)

    broadcast_change(path, :delete)
    {:noreply, state}
  end

  # --- Private ---

  defp get_or_create_sprite(client, name) do
    case Sprites.get_sprite(client, name) do
      {:ok, _info} -> {:ok, Sprites.sprite(client, name)}
      {:error, {:not_found, _}} -> Sprites.create(client, name)
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize_drive_path(path) do
    clean = path |> String.trim_leading("/") |> String.trim_trailing("/")

    if clean == "" do
      @drive_root
    else
      "#{@drive_root}/#{clean}"
    end
  end

  defp list_drive_files_recursive(sprite) do
    case Sprites.cmd(sprite, "find", [
           @drive_root,
           "-path",
           "#{@drive_root}/.sync-meta",
           "-prune",
           "-o",
           "-type",
           "f",
           "-print"
         ]) do
      {output, 0} -> {:ok, parse_find_output(output)}
      {_, code} -> {:error, "find exited with code #{code}"}
    end
  end

  defp list_drive_files_since(sprite, marker_path) do
    case Sprites.cmd(sprite, "find", [
           @drive_root,
           "-path",
           "#{@drive_root}/.sync-meta",
           "-prune",
           "-o",
           "-newer",
           marker_path,
           "-type",
           "f",
           "-print"
         ]) do
      {output, 0} -> {:ok, parse_find_output(output)}
      {_, code} -> {:error, "find exited with code #{code}"}
    end
  end

  @doc false
  def parse_find_output(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.map(&String.trim_leading(&1, "#{@drive_root}/"))
    |> Enum.reject(&(&1 == "" or &1 == @drive_root))
  end

  defp parse_ls_output(output, current_path) do
    output
    |> String.split("\n", trim: true)
    |> Enum.drop(1)
    |> Enum.map(&parse_ls_line(&1, current_path))
    |> Enum.reject(&is_nil/1)
  end

  defp parse_ls_line(line, current_path) do
    # Format: drwxr-xr-x 2 root root 4096 1710590400 dirname
    # Format: -rw-r--r-- 1 root root 1234 1710590400 filename
    case String.split(line, ~r/\s+/, parts: 7) do
      [perms, _links, _owner, _group, size, _timestamp, name] when name not in [".", ".."] ->
        type = if String.starts_with?(perms, "d"), do: "directory", else: "file"
        clean_path = String.trim_leading(current_path, "/")

        full_path =
          if clean_path == "" do
            name
          else
            "#{clean_path}/#{name}"
          end

        %{
          name: name,
          path: full_path,
          type: type,
          size: parse_int(size)
        }

      _ ->
        nil
    end
  end

  defp parse_int(str) do
    case Integer.parse(str) do
      {n, _} -> n
      :error -> 0
    end
  end

  defp fan_out_write(exclude_agent_id, path, content) do
    running_agents()
    |> Enum.reject(fn {agent_id, _pid} -> agent_id == exclude_agent_id end)
    |> Enum.each(fn {agent_id, _pid} ->
      GenServer.cast(
        {:via, Registry, {Shire.AgentRegistry, agent_id}},
        {:drive_sync, path, content}
      )
    end)
  end

  defp fan_out_delete(exclude_agent_id, path) do
    running_agents()
    |> Enum.reject(fn {agent_id, _pid} -> agent_id == exclude_agent_id end)
    |> Enum.each(fn {agent_id, _pid} ->
      GenServer.cast(
        {:via, Registry, {Shire.AgentRegistry, agent_id}},
        {:drive_delete, path}
      )
    end)
  end

  defp running_agents do
    Registry.select(Shire.AgentRegistry, [
      {{:"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}
    ])
  end

  defp broadcast_change(path, action) do
    Phoenix.PubSub.broadcast(
      Shire.PubSub,
      "shared-drive",
      {:drive_changed, path, action}
    )
  end
end
