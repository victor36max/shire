import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { unwrap } from "./util";

export interface SharedDriveFile {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

export interface SharedDriveResponse {
  files: SharedDriveFile[];
  currentPath: string;
}

export function useSharedDrive(projectId: string | undefined, path: string) {
  return useQuery<SharedDriveResponse>({
    queryKey: ["shared-drive", projectId, path],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"]["shared-drive"].$get({
          param: { id: projectId! },
          query: { path },
        }),
      ) as unknown as SharedDriveResponse,
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
