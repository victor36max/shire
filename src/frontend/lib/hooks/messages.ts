import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useMessages(projectId: string | undefined, agentId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["messages", projectId, agentId],
    queryFn: async ({ pageParam }) => {
      const query: Record<string, string> = {};
      if (pageParam != null) query.before = String(pageParam);
      return unwrap(
        await api.projects[":id"].agents[":aid"].messages.$get({
          param: { id: projectId!, aid: agentId! },
          query,
        }),
      );
    },
    enabled: !!projectId && !!agentId,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.messages.length === 0) return undefined;
      // Oldest message in the page is the cursor for the next (older) page
      return lastPage.messages[0].id as number;
    },
  });
}

export function useSendMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      agentId,
      text,
      attachments,
    }: {
      agentId: string;
      text: string;
      attachments?: Record<string, unknown>[];
    }) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].message.$post({
          param: { id: projectId, aid: agentId },
          json: { text, attachments },
        }),
      ),
    onSuccess: (_data, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["messages", projectId, agentId] }),
  });
}

export function useInterruptAgent(projectId: string) {
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].interrupt.$post({
          param: { id: projectId, aid: agentId },
        }),
      ),
  });
}

export function useMarkRead(projectId: string) {
  return useMutation({
    mutationFn: async ({ agentId, messageId }: { agentId: string; messageId: number }) =>
      unwrap(
        await api.projects[":id"].agents[":aid"]["mark-read"].$post({
          param: { id: projectId, aid: agentId },
          json: { messageId },
        }),
      ),
  });
}

export function useClearSession(projectId: string) {
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].clear.$post({
          param: { id: projectId, aid: agentId },
        }),
      ),
  });
}
