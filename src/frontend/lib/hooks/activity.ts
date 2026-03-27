import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useActivity(projectId: string | undefined) {
  return useQuery({
    queryKey: ["activity", projectId],
    queryFn: async () =>
      unwrap(await api.projects[":id"].activity.$get({ param: { id: projectId! }, query: {} })),
    enabled: !!projectId,
  });
}
