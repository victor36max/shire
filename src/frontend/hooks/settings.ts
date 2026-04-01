import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { unwrap } from "./util";

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
