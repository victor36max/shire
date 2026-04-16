import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { setAccessToken } from "../lib/auth";
import { resetRefreshState } from "../components/RequireAuth";
import { api } from "../lib/api";
import { unwrap } from "./util";

export function useAppConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => unwrap(await api.config.$get()),
    staleTime: Infinity,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await api.auth.login.$post({ json: credentials });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = "Login failed";
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // keep default
        }
        throw new Error(message);
      }
      return res.json() as Promise<{ accessToken: string; username: string }>;
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      resetRefreshState();
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.auth.logout.$post();
    },
    onSuccess: () => {
      setAccessToken(null);
      resetRefreshState();
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });
}
