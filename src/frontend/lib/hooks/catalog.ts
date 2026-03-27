import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useCatalogAgents(enabled = false) {
  return useQuery({
    queryKey: ["catalog-agents"],
    queryFn: async () => unwrap(await api.catalog.agents.$get({ query: {} })),
    enabled,
  });
}

export function useCatalogCategories(enabled = false) {
  return useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => unwrap(await api.catalog.categories.$get()),
    enabled,
  });
}

export function useCatalogAgent(name: string | undefined) {
  return useQuery({
    queryKey: ["catalog-agent", name],
    queryFn: async () => unwrap(await api.catalog.agents[":name"].$get({ param: { name: name! } })),
    enabled: !!name,
  });
}
