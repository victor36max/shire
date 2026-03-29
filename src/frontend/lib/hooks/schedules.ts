import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { unwrap } from "./util";
import type { ScheduledTask } from "../../components/types";

export function useSchedules(projectId: string | undefined) {
  return useQuery<ScheduledTask[]>({
    queryKey: ["schedules", projectId],
    queryFn: async () =>
      unwrap(
        await api.projects[":id"].schedules.$get({ param: { id: projectId! } }),
      ) as unknown as Promise<ScheduledTask[]>,
    enabled: !!projectId,
  });
}

export function useCreateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      agentId: string;
      label: string;
      message: string;
      scheduleType: "once" | "recurring";
      cronExpression?: string;
      scheduledAt?: string;
      enabled?: boolean;
    }) =>
      unwrap(await api.projects[":id"].schedules.$post({ param: { id: projectId }, json: data })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useUpdateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      agentId?: string;
      label?: string;
      message?: string;
      scheduleType?: "once" | "recurring";
      cronExpression?: string;
      scheduledAt?: string;
      enabled?: boolean;
    }) =>
      unwrap(
        await api.projects[":id"].schedules[":sid"].$patch({
          param: { id: projectId, sid: id },
          json: data,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useDeleteSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.projects[":id"].schedules[":sid"].$delete({
          param: { id: projectId, sid: id },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useToggleSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(
        await api.projects[":id"].schedules[":sid"].toggle.$post({
          param: { id: projectId, sid: id },
          json: { enabled },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useRunScheduleNow(projectId: string) {
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.projects[":id"].schedules[":sid"].run.$post({
          param: { id: projectId, sid: id },
        }),
      ),
  });
}
