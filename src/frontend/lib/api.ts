import { hc } from "hono/client";
import type { AppType } from "../../server";
import { useAuthStore, getAccessToken, isTokenExpired } from "../stores/auth";

export async function getValidToken(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;
  if (!isTokenExpired(token)) return token;
  return useAuthStore.getState().refreshAccessToken();
}

const client = hc<AppType>("/", {
  headers: async (): Promise<Record<string, string>> => {
    const token = await getValidToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    let res = await fetch(input, { ...init, credentials: "include" });
    if (res.status === 401 && getAccessToken()) {
      const newToken = await useAuthStore.getState().refreshAccessToken();
      if (newToken) {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${newToken}`);
        res = await fetch(input, { ...init, headers, credentials: "include" });
      }
    }
    return res;
  },
});

export const api = client.api;
