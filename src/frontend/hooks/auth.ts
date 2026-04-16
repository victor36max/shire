import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuthStore } from "../lib/auth";
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
  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }) =>
      unwrap(await api.auth.login.$post({ json: credentials })) as unknown as {
        accessToken: string;
        username: string;
      },
    onSuccess: (data) => {
      const store = useAuthStore.getState();
      store.reset();
      store.setAccessToken(data.accessToken);
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await api.auth.logout.$post();
    },
    onSuccess: () => {
      useAuthStore.getState().reset();
    },
  });
}
