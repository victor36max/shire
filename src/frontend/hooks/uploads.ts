import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface UploadResult {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

function uploadWithProgress<T>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as T);
      } else {
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.send(formData);
  });
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
      return uploadWithProgress<UploadResult>(
        `/api/projects/${projectId}/agents/${agentId}/attachments`,
        formData,
        onProgress,
      );
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
      return uploadWithProgress<{ ok: boolean }>(
        `/api/projects/${projectId}/shared-drive/upload`,
        formData,
        onProgress,
      );
    },
  });
}
