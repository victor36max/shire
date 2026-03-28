import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";
import type { InterAgentMessage } from "../../components/types";

interface ActivityResponse {
  messages: InterAgentMessage[];
  hasMore: boolean;
}

export function useActivity(projectId: string | undefined) {
  return useInfiniteQuery<ActivityResponse>({
    queryKey: ["activity", projectId],
    queryFn: async ({ pageParam }) => {
      const query: Record<string, string> = {};
      if (pageParam != null) query.before = String(pageParam);
      return unwrap(
        await api.projects[":id"].activity.$get({ param: { id: projectId! }, query }),
      ) as unknown as ActivityResponse;
    },
    enabled: !!projectId,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.messages.length === 0) return undefined;
      // Activity is displayed newest-first; oldest message in page is the cursor
      return lastPage.messages[lastPage.messages.length - 1].id as number;
    },
  });
}
