defmodule Shire.Agent.SpriteHelpers do
  @moduledoc """
  Shared helpers for working with the Sprites SDK.
  """

  @doc """
  Work around SDK bug: filesystem ops miss /v1/sprites/{name} prefix.
  Patches the Req client's base_url to include the sprite path prefix.
  """
  def filesystem(sprite) do
    prefix = "/v1/sprites/#{URI.encode(sprite.name)}"
    patched_req = Req.merge(sprite.client.req, base_url: sprite.client.base_url <> prefix)
    patched_client = %{sprite.client | req: patched_req}
    patched_sprite = %{sprite | client: patched_client}
    Sprites.filesystem(patched_sprite)
  end
end
