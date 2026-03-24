defmodule Shire.VirtualMachineSSH.KeyCb do
  @moduledoc """
  SSH client key callback for in-memory private key authentication.

  Implements the `:ssh_client_key_api` behaviour. Decodes a raw PEM string
  provided in options and returns the key for authentication.
  Accepts all host keys (no known_hosts verification).
  """

  require Logger

  @behaviour :ssh_client_key_api

  @impl true
  def is_host_key(_key, _host, _port, _algorithm, _opts) do
    true
  end

  @impl true
  def user_key(algorithm, opts) do
    case opts[:key_pem] do
      nil ->
        {:error, :no_key}

      pem ->
        case :public_key.pem_decode(pem) do
          [] ->
            Logger.error(
              "SSH key PEM decode returned no entries — key may be malformed or have incorrect newlines"
            )

            {:error, :no_matching_key}

          entries ->
            case find_key_for_algorithm(entries, algorithm) do
              {:ok, key} -> {:ok, key}
              :error -> {:error, :no_matching_key}
            end
        end
    end
  end

  defp find_key_for_algorithm(pem_entries, algorithm) do
    Enum.find_value(pem_entries, :error, fn entry ->
      key = :public_key.pem_entry_decode(entry)

      if key_matches_algorithm?(key, algorithm) do
        {:ok, key}
      end
    end)
  end

  defp key_matches_algorithm?(key, algorithm) do
    case {key, algorithm} do
      {{:RSAPrivateKey, _, _, _, _, _, _, _, _, _, _}, :"ssh-rsa"} ->
        true

      {{:ECPrivateKey, _, _, _, _}, algo} ->
        String.starts_with?(Atom.to_string(algo), "ecdsa-sha2-")

      {{:ed_pri, :ed25519, _, _}, :"ssh-ed25519"} ->
        true

      {{:ed_pri, :ed448, _, _}, :"ssh-ed448"} ->
        true

      {{:DSAPrivateKey, _, _, _, _, _, _}, :"ssh-dss"} ->
        true

      _ ->
        false
    end
  end
end
