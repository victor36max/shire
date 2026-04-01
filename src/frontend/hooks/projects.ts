import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { unwrap } from "./util";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => unwrap(await api.projects.$get()),
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
    mutationFn: async (name: string) => unwrap(await api.projects.$post({ json: { name } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.projects[":id"].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRestartProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.projects[":id"].restart.$post({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRenameProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await api.projects[":id"].$patch({ param: { id: projectId }, json: { name } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
