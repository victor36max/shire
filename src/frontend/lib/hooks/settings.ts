import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useEnv(projectId: string | undefined) {
  return useQuery({
    queryKey: ["env", projectId],
    queryFn: async () =>
      unwrap(await api.projects[":id"].settings.env.$get({ param: { id: projectId! } })),
    enabled: !!projectId,
  });
}

export function useSaveEnv(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) =>
      unwrap(
        await api.projects[":id"].settings.env.$put({
          param: { id: projectId },
          json: { content },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["env", projectId] }),
  });
}

export function useScripts(projectId: string | undefined) {
  return useQuery({
    queryKey: ["scripts", projectId],
    queryFn: async () =>
      unwrap(await api.projects[":id"].settings.scripts.$get({ param: { id: projectId! } })),
    enabled: !!projectId,
  });
}

export function useSaveScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, content }: { name: string; content: string }) =>
      unwrap(
        await api.projects[":id"].settings.scripts[":name"].$put({
          param: { id: projectId, name },
          json: { content },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts", projectId] }),
  });
}

export function useDeleteScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(
        await api.projects[":id"].settings.scripts[":name"].$delete({
          param: { id: projectId, name },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts", projectId] }),
  });
}

export function useRunScript(projectId: string) {
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(
        await api.projects[":id"].settings.scripts[":name"].run.$post({
          param: { id: projectId, name },
        }),
      ),
  });
}

export function useProjectDoc(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-doc", projectId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].settings["project-doc"].$get({
          param: { id: projectId! },
        }),
      ),
    enabled: !!projectId,
  });
}

export function useSaveProjectDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) =>
      unwrap(
        await api.projects[":id"].settings["project-doc"].$put({
          param: { id: projectId },
          json: { content },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-doc", projectId] }),
  });
}
