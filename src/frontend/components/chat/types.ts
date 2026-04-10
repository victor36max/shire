export interface Attachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
}

export interface Message {
  id?: number;
  role: string;
  text?: string;
  ts: string;
  tool?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string | null;
  isError?: boolean;
  fromAgent?: string;
  attachments?: Attachment[];
}

export interface PendingFile {
  localId: string;
  name: string;
  size: number;
  content_type: string;
  uploadId: string | null;
  progress: number; // 0 = queued, 1-99 = uploading, 100 = done
  error?: string;
}

export const MAX_FILE_SIZE = 128 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
