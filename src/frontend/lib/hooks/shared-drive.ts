import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useSharedDrive(projectId: string | undefined, path: string) {
  return useQuery({
    queryKey: ["shared-drive", projectId, path],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"]["shared-drive"].$get({
          param: { id: projectId! },
          query: { path },
        }),
      ),
    enabled: !!projectId,
  });
}

export function useCreateDirectory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, path }: { name: string; path: string }) =>
      unwrap(
        await api.projects[":id"]["shared-drive"].directory.$post({
          param: { id: projectId },
          json: { name, path },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
  });
}

export function useDeleteSharedFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) =>
      unwrap(
        await api.projects[":id"]["shared-drive"].$delete({
          param: { id: projectId },
          query: { path },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
  });
}

export function useUploadFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, content, path }: { name: string; content: string; path: string }) =>
      unwrap(
        await api.projects[":id"]["shared-drive"].upload.$post({
          param: { id: projectId },
          json: { name, content, path },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
  });
}

export function usePreviewFile(projectId: string) {
  return useMutation({
    mutationFn: async (path: string) =>
      unwrap(
        await api.projects[":id"]["shared-drive"].preview.$get({
          param: { id: projectId },
          query: { path },
        }),
      ),
  });
}
