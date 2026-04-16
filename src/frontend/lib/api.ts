import { hc } from "hono/client";
import type { AppType } from "../../server";
import { useAuthStore, getAccessToken } from "./auth";

const client = hc<AppType>("/", {
  headers: (): Record<string, string> => {
    const token = getAccessToken();
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
      } else {
        window.location.href = "/login";
      }
    }
    return res;
  },
});

export const api = client.api;
