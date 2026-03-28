import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";

/** Shape returned by the messages API endpoint. */
export interface MessagesResponse {
  messages: Array<{
    id: number;
    projectId: string;
    agentId: string;
    role: string;
    content: Record<string, unknown>;
    createdAt: string;
  }>;
  hasMore: boolean;
}

export function useMessages(projectId: string | undefined, agentId: string | undefined) {
  return useQuery<MessagesResponse>({
    queryKey: ["messages", projectId, agentId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].agents[":aid"].messages.$get({
          param: { id: projectId!, aid: agentId! },
          query: {},
        }),
      ) as unknown as MessagesResponse,
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
      ) as unknown as MessagesResponse,
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
      attachments?: Array<{
        id?: string;
        name?: string;
        filename?: string;
        content?: string;
        content_type: string;
        size?: number;
      }>;
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
