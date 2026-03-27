import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

export function useMessages(projectId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: ["messages", projectId, agentId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].agents[":aid"].messages.$get({
          param: { id: projectId!, aid: agentId! },
          query: {},
        }),
      ),
    enabled: !!projectId && !!agentId,
  });
}

export function useLoadMoreMessages(projectId: string) {
  return useMutation({
    mutationFn: async ({ agentId, before }: { agentId: string; before: number }) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].messages.$get({
          param: { id: projectId, aid: agentId },
          query: { before: String(before) },
        }),
      ),
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
