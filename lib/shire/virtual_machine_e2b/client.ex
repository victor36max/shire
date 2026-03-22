defmodule Shire.VirtualMachineE2B.Client do
  @moduledoc """
  HTTP client helpers for E2B's two-tier API:
  - Management API (api.e2b.dev) for sandbox lifecycle
  - Sandbox API ({sandbox_id}-{port}.e2b.dev) for filesystem and process operations
  """

  @management_base_url "https://api.e2b.dev"
  @sandbox_port 49983

  # --- Req Builders ---

  def management_req(api_key) do
    Req.new(
      base_url: @management_base_url,
      headers: [{"x-api-key", api_key}]
    )
  end

  def sandbox_req(sandbox_id, access_token) do
    Req.new(
      base_url: sandbox_base_url(sandbox_id),
      headers: [
        {"x-access-token", access_token}
      ]
    )
  end

  # --- Management API ---

  def create_sandbox(api_key, template_id, metadata \\ %{}, timeout_secs \\ 3600) do
    body = %{
      "templateID" => template_id,
      "timeout" => timeout_secs,
      "metadata" => metadata
    }

    case Req.post(management_req(api_key), url: "/sandboxes", json: body) do
      {:ok, %Req.Response{status: status, body: body}} when status in [200, 201] ->
        {:ok,
         %{
           sandbox_id: body["sandboxID"],
           access_token: body["envdAccessToken"],
           client_id: body["clientID"]
         }}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_sandboxes(api_key) do
    case Req.get(management_req(api_key), url: "/sandboxes") do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def find_sandbox_by_metadata(api_key, key, value) do
    case list_sandboxes(api_key) do
      {:ok, sandboxes} ->
        found =
          Enum.find(sandboxes, fn sb ->
            get_in(sb, ["metadata", key]) == value
          end)

        {:ok, found}

      error ->
        error
    end
  end

  def refresh_sandbox(api_key, sandbox_id, duration_secs \\ 1800) do
    body = %{"duration" => duration_secs}

    case Req.post(management_req(api_key), url: "/sandboxes/#{sandbox_id}/refreshes", json: body) do
      {:ok, %Req.Response{status: status}} when status in [200, 204] ->
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def delete_sandbox(api_key, sandbox_id) do
    case Req.delete(management_req(api_key), url: "/sandboxes/#{sandbox_id}") do
      {:ok, %Req.Response{status: status}} when status in [200, 204] ->
        :ok

      {:ok, %Req.Response{status: 404}} ->
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # --- Sandbox Filesystem API ---

  def read_file(sandbox_id, access_token, path) do
    req = sandbox_req(sandbox_id, access_token)

    case Req.get(req, url: "/files", params: [path: path]) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def write_file(sandbox_id, access_token, path, content) do
    req = sandbox_req(sandbox_id, access_token)
    boundary = "----E2BUpload" <> Base.encode16(:crypto.strong_rand_bytes(16))
    filename = path |> Path.basename() |> String.replace(~S["], ~S[\"])

    body =
      "--#{boundary}\r\n" <>
        "Content-Disposition: form-data; name=\"file\"; filename=\"#{filename}\"\r\n" <>
        "Content-Type: application/octet-stream\r\n" <>
        "\r\n" <>
        content <>
        "\r\n" <>
        "--#{boundary}--\r\n"

    case Req.post(req,
           url: "/files",
           params: [path: path],
           headers: [{"content-type", "multipart/form-data; boundary=#{boundary}"}],
           body: body
         ) do
      {:ok, %Req.Response{status: status}} when status in [200, 204] ->
        :ok

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def mkdir_p(sandbox_id, access_token, path) do
    json_post(sandbox_id, access_token, "/filesystem.Filesystem/MakeDir", %{"path" => path})
    |> normalize_ok_response()
  end

  def remove(sandbox_id, access_token, path) do
    json_post(sandbox_id, access_token, "/filesystem.Filesystem/Remove", %{"path" => path})
    |> normalize_ok_response()
  end

  def list_dir(sandbox_id, access_token, path) do
    case json_post(sandbox_id, access_token, "/filesystem.Filesystem/ListDir", %{
           "path" => path,
           "depth" => 1
         }) do
      {:ok, %{"entries" => entries}} ->
        {:ok, entries}

      {:ok, body} ->
        {:ok, Map.get(body, "entries", [])}

      error ->
        error
    end
  end

  def stat_path(sandbox_id, access_token, path) do
    json_post(sandbox_id, access_token, "/filesystem.Filesystem/Stat", %{"path" => path})
  end

  # --- Sandbox Process API ---

  def start_process(sandbox_id, access_token, cmd, args, opts \\ []) do
    cwd = Keyword.get(opts, :cwd, "/home/user")
    envs = Keyword.get(opts, :envs, %{})
    tty = Keyword.get(opts, :tty, false)
    stdin = Keyword.get(opts, :stdin, false)
    rows = Keyword.get(opts, :tty_rows, 24)
    cols = Keyword.get(opts, :tty_cols, 80)

    body = %{
      "process" => %{
        "cmd" => cmd,
        "args" => args,
        "envs" => envs,
        "cwd" => cwd
      },
      "stdin" => stdin || tty
    }

    body =
      if tty do
        Map.put(body, "pty", %{"size" => %{"cols" => cols, "rows" => rows}})
      else
        body
      end

    req =
      sandbox_req(sandbox_id, access_token)
      |> Req.merge(
        headers: [
          {"content-type", "application/json"}
        ],
        url: "/process.Process/Start",
        method: :post,
        body: Jason.encode!(body),
        into: :self,
        receive_timeout: :infinity
      )

    Req.request(req)
  end

  def send_input(sandbox_id, access_token, process_pid, data, opts \\ []) do
    tty = Keyword.get(opts, :tty, false)

    input =
      if tty do
        %{"pty" => Base.encode64(data)}
      else
        %{"stdin" => Base.encode64(data)}
      end

    body = %{
      "process" => %{"pid" => process_pid},
      "input" => input
    }

    json_post(sandbox_id, access_token, "/process.Process/SendInput", body)
    |> normalize_ok_response()
  end

  def update_process(sandbox_id, access_token, process_pid, rows, cols) do
    body = %{
      "process" => %{"pid" => process_pid},
      "pty" => %{"size" => %{"cols" => cols, "rows" => rows}}
    }

    json_post(sandbox_id, access_token, "/process.Process/Update", body)
    |> normalize_ok_response()
  end

  # --- JSON RPC Helpers ---

  defp json_post(sandbox_id, access_token, path, body) do
    req = sandbox_req(sandbox_id, access_token)

    case Req.post(req, url: path, json: body) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:api_error, status, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_ok_response({:ok, _}), do: :ok
  defp normalize_ok_response({:error, _} = err), do: err

  defp sandbox_base_url(sandbox_id) do
    "https://#{@sandbox_port}-#{sandbox_id}.e2b.dev"
  end
end
