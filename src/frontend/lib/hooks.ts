import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

const BASE = "/api";

/** Wraps a mutation with automatic error toasts */
function withErrorToast<TData, TVariables>(
  opts: Parameters<typeof useMutation<TData, Error, TVariables>>[0],
): Parameters<typeof useMutation<TData, Error, TVariables>>[0] {
  return {
    ...opts,
    onError: (error, variables, context) => {
      toast.error(error.message || "Something went wrong");
      opts.onError?.(error, variables, context);
    },
  };
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as Record<string, string>).error ?? `${res.status}`);
  }
  return res.json();
}

// --- Project hooks ---

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      fetchJson<Array<{ id: string; name: string; status: string }>>(`${BASE}/projects`),
  });
}

export function useResolveProjectId(projectName: string | undefined) {
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.name === projectName);
  return project?.id;
}

/** Convenience hook: reads projectName from URL params and resolves to projectId */
export function useProjectId() {
  const { projectName } = useParams<{ projectName: string }>();
  const projectId = useResolveProjectId(projectName);
  return { projectId, projectName: projectName ?? "" };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson(`${BASE}/projects`, { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`${BASE}/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRestartProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`${BASE}/projects/${id}/restart`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRenameProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson(`${BASE}/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// --- Agent hooks ---

export function useAgents(projectId: string | undefined) {
  return useQuery({
    queryKey: ["agents", projectId],
    queryFn: () =>
      fetchJson<
        Array<{ id: string; name: string; status: string; lastReadMessageId: number | null }>
      >(`${BASE}/projects/${projectId}/agents`),
    enabled: !!projectId,
  });
}

export function useAgentDetail(projectId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: ["agent-detail", projectId, agentId],
    queryFn: () =>
      fetchJson<Record<string, unknown>>(`${BASE}/projects/${projectId}/agents/${agentId}`),
    enabled: !!projectId && !!agentId,
  });
}

export function useCreateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; recipe_yaml: string }) =>
      fetchJson(`${BASE}/projects/${projectId}/agents`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useUpdateAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, recipe_yaml }: { id: string; recipe_yaml: string }) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ recipe_yaml }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useDeleteAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${agentId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useRestartAgent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${agentId}/restart`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents", projectId] }),
  });
}

export function useSendMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      text,
      attachments,
    }: {
      agentId: string;
      text: string;
      attachments?: unknown[];
    }) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${agentId}/message`, {
        method: "POST",
        body: JSON.stringify({ text, attachments }),
      }),
    onSuccess: (_data, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["messages", projectId, agentId] }),
  });
}

export function useInterruptAgent(projectId: string) {
  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${agentId}/interrupt`, { method: "POST" }),
  });
}

export function useClearSession(projectId: string) {
  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson(`${BASE}/projects/${projectId}/agents/${agentId}/clear`, { method: "POST" }),
  });
}

// --- Messages ---

export function useMessages(projectId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: ["messages", projectId, agentId],
    queryFn: () =>
      fetchJson<{ messages: Array<Record<string, unknown>>; hasMore: boolean }>(
        `${BASE}/projects/${projectId}/agents/${agentId}/messages`,
      ),
    enabled: !!projectId && !!agentId,
  });
}

export function useLoadMoreMessages(projectId: string) {
  return useMutation({
    mutationFn: ({ agentId, before }: { agentId: string; before: number }) =>
      fetchJson<{ messages: Array<Record<string, unknown>>; hasMore: boolean }>(
        `${BASE}/projects/${projectId}/agents/${agentId}/messages?before=${before}`,
      ),
  });
}

// --- Activity Log ---

export function useActivity(projectId: string | undefined) {
  return useQuery({
    queryKey: ["activity", projectId],
    queryFn: () =>
      fetchJson<{ messages: Array<Record<string, unknown>>; hasMore: boolean }>(
        `${BASE}/projects/${projectId}/activity`,
      ),
    enabled: !!projectId,
  });
}

// --- Catalog ---

export function useCatalogAgents(enabled = false) {
  return useQuery({
    queryKey: ["catalog-agents"],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`${BASE}/catalog/agents`),
    enabled,
  });
}

export function useCatalogCategories(enabled = false) {
  return useQuery({
    queryKey: ["catalog-categories"],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`${BASE}/catalog/categories`),
    enabled,
  });
}

export function useCatalogAgent(name: string | undefined) {
  return useQuery({
    queryKey: ["catalog-agent", name],
    queryFn: () => fetchJson<Record<string, unknown>>(`${BASE}/catalog/agents/${name}`),
    enabled: !!name,
  });
}

// --- Settings ---

export function useEnv(projectId: string | undefined) {
  return useQuery({
    queryKey: ["env", projectId],
    queryFn: () => fetchJson<{ content: string }>(`${BASE}/projects/${projectId}/settings/env`),
    enabled: !!projectId,
  });
}

export function useSaveEnv(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      fetchJson(`${BASE}/projects/${projectId}/settings/env`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["env", projectId] }),
  });
}

export function useScripts(projectId: string | undefined) {
  return useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () =>
      fetchJson<Array<{ name: string; content: string }>>(
        `${BASE}/projects/${projectId}/settings/scripts`,
      ),
    enabled: !!projectId,
  });
}

export function useSaveScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      fetchJson(`${BASE}/projects/${projectId}/settings/scripts/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts", projectId] }),
  });
}

export function useDeleteScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson(`${BASE}/projects/${projectId}/settings/scripts/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts", projectId] }),
  });
}

export function useRunScript(projectId: string) {
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson<{ output: string }>(
        `${BASE}/projects/${projectId}/settings/scripts/${encodeURIComponent(name)}/run`,
        { method: "POST" },
      ),
  });
}

export function useProjectDoc(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-doc", projectId],
    queryFn: () =>
      fetchJson<{ content: string }>(`${BASE}/projects/${projectId}/settings/project-doc`),
    enabled: !!projectId,
  });
}

export function useSaveProjectDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      fetchJson(`${BASE}/projects/${projectId}/settings/project-doc`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-doc", projectId] }),
  });
}

// --- Shared Drive ---

export function useSharedDrive(projectId: string | undefined, path: string) {
  return useQuery({
    queryKey: ["shared-drive", projectId, path],
    queryFn: () =>
      fetchJson<{ files: Array<Record<string, unknown>>; currentPath: string }>(
        `${BASE}/projects/${projectId}/shared-drive?path=${encodeURIComponent(path)}`,
      ),
    enabled: !!projectId,
  });
}

// --- Schedules ---

export function useSchedules(projectId: string | undefined) {
  return useQuery({
    queryKey: ["schedules", projectId],
    queryFn: () =>
      fetchJson<Array<Record<string, unknown>>>(`${BASE}/projects/${projectId}/schedules`),
    enabled: !!projectId,
  });
}

export function useCreateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchJson(`${BASE}/projects/${projectId}/schedules`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useUpdateSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown>) =>
      fetchJson(`${BASE}/projects/${projectId}/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useDeleteSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`${BASE}/projects/${projectId}/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useToggleSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetchJson(`${BASE}/projects/${projectId}/schedules/${id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", projectId] }),
  });
}

export function useRunScheduleNow(projectId: string) {
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`${BASE}/projects/${projectId}/schedules/${id}/run`, { method: "POST" }),
  });
}

// --- Shared Drive mutations ---

export function useCreateDirectory(projectId: string) {
  const qc = useQueryClient();
  return useMutation(
    withErrorToast({
      mutationFn: ({ name, path }: { name: string; path: string }) =>
        fetchJson(`${BASE}/projects/${projectId}/shared-drive/directory`, {
          method: "POST",
          body: JSON.stringify({ name, path }),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
    }),
  );
}

export function useDeleteSharedFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation(
    withErrorToast({
      mutationFn: (path: string) =>
        fetchJson(`${BASE}/projects/${projectId}/shared-drive?path=${encodeURIComponent(path)}`, {
          method: "DELETE",
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
    }),
  );
}

export function useUploadFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation(
    withErrorToast({
      mutationFn: ({ name, content, path }: { name: string; content: string; path: string }) =>
        fetchJson(`${BASE}/projects/${projectId}/shared-drive/upload`, {
          method: "POST",
          body: JSON.stringify({ name, content, path }),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
    }),
  );
}

export function usePreviewFile(projectId: string) {
  return useMutation({
    mutationFn: (path: string) =>
      fetchJson<{ content: string; filename: string; size: number }>(
        `${BASE}/projects/${projectId}/shared-drive/preview?path=${encodeURIComponent(path)}`,
      ),
  });
}
