import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useAgents(projectId: string | undefined) {
  return useQuery({
    queryKey: ["agents", projectId],
    queryFn: async () =>
      unwrap(await api.projects[":id"].agents.$get({ param: { id: projectId! } })),
    enabled: !!projectId,
  });
}

export function useAgentDetail(projectId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: ["agent-detail", projectId, agentId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$get({
          param: { id: projectId!, aid: agentId! },
        }),
      ),
    enabled: !!projectId && !!agentId,
  });
}

export function useCreateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; recipe_yaml: string }) =>
      unwrap(await api.projects[":id"].agents.$post({ param: { id: projectId }, json: data })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useUpdateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, recipe_yaml }: { id: string; recipe_yaml: string }) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$patch({
          param: { id: projectId, aid: id },
          json: { recipe_yaml },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useDeleteAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$delete({
          param: { id: projectId, aid: agentId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useRestartAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].restart.$post({
          param: { id: projectId, aid: agentId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}
