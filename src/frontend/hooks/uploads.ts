import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface UploadResult {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export function useUploadAttachment(projectId: string) {
  return useMutation({
    mutationFn: async ({
      agentId,
      file,
      onProgress,
    }: {
      agentId: string;
      file: File;
      onProgress?: (percent: number) => void;
    }): Promise<UploadResult> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await axios.post<UploadResult>(
        `/api/projects/${projectId}/agents/${agentId}/attachments`,
        formData,
        {
          onUploadProgress: (e) => {
            if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
          },
        },
      );
      return res.data;
    },
  });
}

export function useUploadSharedDriveFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared-drive", projectId] }),
    mutationFn: async ({
      file,
      path,
      onProgress,
    }: {
      file: File;
      path: string;
      onProgress?: (percent: number) => void;
    }): Promise<{ ok: boolean }> => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);
      const res = await axios.post<{ ok: boolean }>(
        `/api/projects/${projectId}/shared-drive/upload`,
        formData,
        {
          onUploadProgress: (e) => {
            if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
          },
        },
      );
      return res.data;
    },
  });
}
