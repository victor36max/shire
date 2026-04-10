import * as React from "react";
import { Paperclip, Square, X, FileIcon, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AgentOverview } from "@/components/types";
import {
  useProjectId,
  useSendMessage,
  useInterruptAgent,
  useRestartAgent,
  useUploadAttachment,
  useUpdateAgentCache,
} from "../../hooks";
import { type PendingFile, MAX_FILE_SIZE, formatFileSize } from "./types";

interface ChatInputProps {
  agent: AgentOverview;
  onMessageSent?: () => void;
}

export function ChatInput({ agent, onMessageSent }: ChatInputProps) {
  const { projectId } = useProjectId();
  const updateAgentCache = useUpdateAgentCache(projectId);
  const markBusy = () => updateAgentCache(agent.id, { busy: true });

  const sendMessage = useSendMessage(projectId ?? "");
  const uploadAttachment = useUploadAttachment(projectId ?? "");
  const interruptAgent = useInterruptAgent(projectId ?? "");
  const restartAgent = useRestartAgent(projectId ?? "");

  const [input, setInput] = React.useState("");
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          setUploadError(
            (prev) =>
              (prev ? `${prev}; ` : "") +
              `"${file.name}": File is larger than ${formatFileSize(MAX_FILE_SIZE)}`,
          );
          continue;
        }
        const lid = crypto.randomUUID();
        const pending: PendingFile = {
          localId: lid,
          name: file.name,
          size: file.size,
          content_type: file.type || "application/octet-stream",
          uploadId: null,
          progress: 0,
        };
        setPendingFiles((prev) => [...prev, pending]);

        uploadAttachment
          .mutateAsync({
            agentId: agent.id,
            file,
            onProgress: (percent: number) => {
              setPendingFiles((prev) =>
                prev.map((f) => (f.localId === lid ? { ...f, progress: percent } : f)),
              );
            },
          })
          .then((result: { id: string }) => {
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === lid ? { ...f, uploadId: result.id, progress: 100 } : f,
              ),
            );
          })
          .catch((err: unknown) => {
            const errorMsg = err instanceof Error ? err.message : "Upload failed";
            setPendingFiles((prev) =>
              prev.map((f) => (f.localId === lid ? { ...f, error: errorMsg, progress: 0 } : f)),
            );
          });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [agent.id, uploadAttachment],
  );

  const removePendingFile = React.useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const anyPending = pendingFiles.some((f) => f.uploadId === null && !f.error);

  const handleSend = () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (anyPending) return;

    const attachmentIds = pendingFiles
      .filter((f) => f.uploadId !== null)
      .map((f) => f.uploadId as string);

    markBusy();
    onMessageSent?.();
    sendMessage.mutate(
      {
        agentId: agent.id,
        text: text || "",
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      },
      {
        onSuccess: () => {
          setInput("");
          setPendingFiles([]);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
        },
        onError: (err) => {
          setUploadError(`Failed to send: ${err instanceof Error ? err.message : "unknown error"}`);
        },
      },
    );
  };

  if (agent.status === "idle") {
    return (
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Agent is idle. It will restart automatically when the VM wakes up.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restartAgent.mutate(agent.id)}
            disabled={restartAgent.isPending}
          >
            {restartAgent.isPending ? "Restarting..." : "Restart"}
          </Button>
        </div>
      </div>
    );
  }

  if (agent.status !== "active") return null;

  return (
    <div className="border-t border-border p-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => handleFileSelect(e.target.files)}
      />
      {uploadError && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs">
          <span className="flex-1">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="hover:text-destructive/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((file, i) => (
            <div
              key={file.localId}
              className="flex flex-col rounded-md border border-border bg-muted/50 text-xs overflow-hidden"
            >
              <div className="flex items-center gap-1.5 px-2 py-1">
                {file.error ? (
                  <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                ) : file.progress === 100 ? (
                  <Check className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <FileIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="truncate max-w-32">{file.name}</span>
                <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
                <button
                  type="button"
                  onClick={() => removePendingFile(i)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {file.progress > 0 && file.progress < 100 && (
                <div className="h-0.5 bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
          }}
          placeholder="Type a message..."
          rows={1}
          className="min-h-0 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {agent.busy ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={() => interruptAgent.mutate(agent.id)}
            aria-label="Stop"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={sendMessage.isPending || anyPending}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
