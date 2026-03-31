import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";
import type { AlertChannel, AlertChannelConfig } from "../../components/types";

export function useAlertChannel(projectId: string | undefined) {
  return useQuery<AlertChannel | null>({
    queryKey: ["alertChannel", projectId],
    queryFn: async () => {
      const res = await api.projects[":id"]["alert-channel"].$get({
        param: { id: projectId! },
      });
      if (res.status === 404) return null;
      return (await unwrap(res)) as AlertChannel;
    },
    enabled: !!projectId,
  });
}

export function useUpsertAlertChannel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { config: AlertChannelConfig; enabled?: boolean }) =>
      unwrap(
        await api.projects[":id"]["alert-channel"].$put({
          param: { id: projectId },
          json: data,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alertChannel", projectId] }),
  });
}

export function useDeleteAlertChannel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.projects[":id"]["alert-channel"].$delete({
          param: { id: projectId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alertChannel", projectId] }),
  });
}

export function useTestAlertChannel(projectId: string) {
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.projects[":id"]["alert-channel"].test.$post({
          param: { id: projectId },
        }),
      ),
  });
}
