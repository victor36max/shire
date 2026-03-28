import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";
import type { CatalogAgent, CatalogAgentSummary, CatalogCategory } from "../../components/types";

export function useCatalogAgents(enabled = false) {
  return useQuery<CatalogAgentSummary[]>({
    queryKey: ["catalog-agents"],
    queryFn: async () =>
      unwrap(await api.catalog.agents.$get({ query: {} })) as unknown as CatalogAgentSummary[],
    enabled,
  });
}

export function useCatalogCategories(enabled = false) {
  return useQuery<CatalogCategory[]>({
    queryKey: ["catalog-categories"],
    queryFn: async () =>
      unwrap(await api.catalog.categories.$get()) as unknown as CatalogCategory[],
    enabled,
  });
}

export function useCatalogAgent(name: string | undefined) {
  return useQuery<CatalogAgent>({
    queryKey: ["catalog-agent", name],
    queryFn: async () =>
      unwrap(
        await api.catalog.agents[":name"].$get({ param: { name: name! } }),
      ) as unknown as CatalogAgent,
    enabled: !!name,
  });
}
