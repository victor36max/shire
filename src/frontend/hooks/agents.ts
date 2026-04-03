import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { unwrap } from "./util";
import type { AgentOverview, Agent, Skill } from "../components/types";

export function useAgents(projectId: string | undefined) {
  return useQuery<AgentOverview[]>({
    queryKey: ["agents", projectId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].agents.$get({ param: { id: projectId! } }),
      ) as unknown as AgentOverview[],
    enabled: !!projectId,
  });
}

export function useUpdateAgentCache(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(
    (agentId: string, patch: Partial<AgentOverview>) => {
      queryClient.setQueryData<AgentOverview[]>(["agents", projectId], (prev) =>
        prev?.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
      );
    },
    [queryClient, projectId],
  );
}

export function findDefaultAgent(agents: AgentOverview[]): AgentOverview | undefined {
  let best: AgentOverview | undefined;
  for (const agent of agents) {
    if (
      agent.lastUserMessageAt &&
      (!best?.lastUserMessageAt || agent.lastUserMessageAt > best.lastUserMessageAt)
    ) {
      best = agent;
    }
  }
  return best;
}

export function useAgentDetail(projectId: string | undefined, agentId: string | undefined) {
  return useQuery<Agent>({
    queryKey: ["agent-detail", projectId, agentId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$get({
          param: { id: projectId!, aid: agentId! },
        }),
      ) as unknown as Agent,
    enabled: !!projectId && !!agentId,
  });
}

interface AgentMutationData {
  name: string;
  description?: string;
  harness?: "claude_code" | "pi" | "opencode";
  model?: string;
  systemPrompt?: string;
  skills?: Skill[];
}

export function useCreateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: AgentMutationData) =>
      unwrap(await api.projects[":id"].agents.$post({ param: { id: projectId }, json: data })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useUpdateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string } & Partial<AgentMutationData>) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$patch({
          param: { id: projectId, aid: id },
          json: fields,
        }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["agents", projectId] });
      qc.invalidateQueries({ queryKey: ["agent-detail", projectId, vars.id] });
    },
  });
}

export function useDeleteAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].$delete({
          param: { id: projectId, aid: agentId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useRestartAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) =>
      unwrap(
        await api.projects[":id"].agents[":aid"].restart.$post({
          param: { id: projectId, aid: agentId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}
