defmodule SpriteAgents.Mailbox do
  @moduledoc """
  Encodes/decodes mailbox message envelopes and generates filenames.
  Also provides helpers to write messages to a Sprite's inbox via the filesystem API.
  """

  defstruct [:seq, :ts, :type, :from, :payload]

  @inbox_dir "/workspace/mailbox/inbox"

  @doc "Encode a message envelope to JSON."
  def encode(type, from, payload, opts \\ []) do
    ts = Keyword.get(opts, :ts, System.os_time(:millisecond))
    seq = Keyword.get(opts, :seq, 0)

    Jason.encode!(%{
      seq: seq,
      ts: ts,
      type: type,
      from: from,
      payload: payload
    })
  end

  @doc "Decode a JSON message envelope."
  def decode(json) do
    case Jason.decode(json) do
      {:ok, %{"seq" => seq, "ts" => ts, "type" => type, "from" => from, "payload" => payload}} ->
        {:ok, %__MODULE__{seq: seq, ts: ts, type: type, from: from, payload: payload}}

      {:ok, _} ->
        {:error, :invalid_envelope}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Generate a mailbox filename."
  def filename(seq, type, opts \\ []) do
    ts = Keyword.get(opts, :ts, System.os_time(:millisecond))
    seq_str = seq |> Integer.to_string() |> String.pad_leading(6, "0")
    "#{seq_str}_#{ts}_#{type}.json"
  end

  @doc "Parse a JSONL stdout line from the agent runner."
  def parse_stdout_line(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      :ignore
    else
      case Jason.decode(trimmed) do
        {:ok, event} -> {:ok, event}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @doc """
  Write a message to a Sprite's inbox using the Sprites filesystem API.
  """
  def write_inbox(sprite, type, payload, opts \\ []) do
    from = Keyword.get(opts, :from, "coordinator")
    seq = Keyword.get(opts, :seq, next_seq(sprite))
    ts = System.os_time(:millisecond)

    json = encode(type, from, payload, seq: seq, ts: ts)
    fname = filename(seq, type, ts: ts)
    final_path = "#{@inbox_dir}/#{fname}"

    fs = filesystem(sprite)

    case Sprites.Filesystem.write(fs, final_path, json) do
      :ok ->
        update_seq(sprite, seq)
        {:ok, seq}

      {:error, reason} ->
        {:error, {:write_failed, reason}}
    end
  end

  defp next_seq(sprite) do
    case Sprites.cmd(sprite, "cat", ["/workspace/mailbox/.inbox_seq"]) do
      {output, 0} ->
        output |> String.trim() |> String.to_integer() |> Kernel.+(1)

      _ ->
        1
    end
  end

  defp update_seq(sprite, seq) do
    fs = filesystem(sprite)
    :ok = Sprites.Filesystem.write(fs, "/workspace/mailbox/.inbox_seq", to_string(seq))
  end

  # Work around SDK bug: filesystem ops miss /v1/sprites/{name} prefix.
  defp filesystem(sprite) do
    prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
    patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
    patched_client = %{sprite.client | req: patched_req}
    patched_sprite = %{sprite | client: patched_client}
    Sprites.filesystem(patched_sprite)
  end
end
