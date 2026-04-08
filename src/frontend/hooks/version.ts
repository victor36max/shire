import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { unwrap } from "./util";

export function useVersionCheck() {
  return useQuery({
    queryKey: ["version-check"],
    queryFn: async () => unwrap(await api.version.$get()),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: 60 * 60 * 1000,
  });
}
