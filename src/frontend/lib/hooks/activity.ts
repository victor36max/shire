import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";
import type { InterAgentMessage } from "../../components/types";

interface ActivityResponse {
  messages: InterAgentMessage[];
  hasMore: boolean;
}

export function useActivity(projectId: string | undefined) {
  return useQuery<ActivityResponse>({
    queryKey: ["activity", projectId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].activity.$get({ param: { id: projectId! }, query: {} }),
      ) as unknown as ActivityResponse,
    enabled: !!projectId,
  });
}
