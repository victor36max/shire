import * as React from "react";
import { Paperclip, Square, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AgentOverview } from "@/components/types";
import {
  useProjectId,
  useSendMessage,
  useInterruptAgent,
  useUploadAttachment,
  useUpdateAgentCache,
} from "../../hooks";
import { useNavigate } from "react-router-dom";
import { useFileMention } from "../../hooks/use-file-mention";
import type { SharedDriveFile } from "../../hooks/shared-drive";
import { useIsDesktop } from "../../hooks/use-is-desktop";
import { useProjectLayout } from "../../providers/ProjectLayoutProvider";
import { type PendingFile, MAX_FILE_SIZE, formatFileSize } from "./types";
import { getFileIcon } from "../../lib/file-utils";
import { FileMentionDropdown } from "./FileMentionDropdown";

export interface ChatInputHandle {
  addFiles: (files: File[]) => void;
}

interface ChatInputProps {
  agent: AgentOverview;
  onMessageSent?: () => void;
}

export const ChatInput = React.forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { agent, onMessageSent },
  ref,
) {
  const { projectId } = useProjectId();
  const updateAgentCache = useUpdateAgentCache(projectId);
  const markBusy = () => updateAgentCache(agent.id, { busy: true });

  const sendMessage = useSendMessage(projectId ?? "");
  const uploadAttachment = useUploadAttachment(projectId ?? "");
  const interruptAgent = useInterruptAgent(projectId ?? "");

  const [input, setInput] = React.useState("");
  const [cursorPos, setCursorPos] = React.useState(0);
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const mention = useFileMention(input, cursorPos, projectId);
  const { selectItem, triggerIndex, dismiss } = mention;
  const { projectName, setPanelFilePath } = useProjectLayout();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();

  const handleMentionPreview = React.useCallback(
    (item: SharedDriveFile) => {
      if (item.type !== "file") return;
      if (isDesktop) {
        setPanelFilePath(item.path);
      } else {
        navigate(`/projects/${projectName}/shared?file=${encodeURIComponent(item.path)}`);
      }
      dismiss();
    },
    [isDesktop, setPanelFilePath, navigate, projectName, dismiss],
  );

  const insertMention = React.useCallback(
    (mentionText: string) => {
      const before = input.slice(0, triggerIndex);
      const after = input.slice(cursorPos);
      const newInput = before + mentionText + " " + after;
      setInput(newInput);
      const newCursorPos = before.length + mentionText.length + 1;
      setCursorPos(newCursorPos);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current?.focus();
      });
    },
    [input, cursorPos, triggerIndex],
  );

  const handleMentionSelect = React.useCallback(
    (item: SharedDriveFile) => {
      if (item.type === "directory") {
        // Replace @query with @dirPath/ so the hook navigates into the directory
        const before = input.slice(0, triggerIndex + 1); // keep the @
        const after = input.slice(cursorPos);
        const dirQuery = item.path.slice(1) + "/"; // strip leading /, add trailing /
        const newInput = before + dirQuery + after;
        const newCursorPos = triggerIndex + 1 + dirQuery.length;
        setInput(newInput);
        setCursorPos(newCursorPos);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current?.focus();
        });
        return;
      }
      const result = selectItem(item);
      if (result !== null) {
        insertMention(result);
      }
    },
    [selectItem, insertMention, input, cursorPos, triggerIndex],
  );

  const handleNavigateBack = React.useCallback(() => {
    // Trim the last path segment from the query: @docs/sub/ → @docs/
    const before = input.slice(0, triggerIndex + 1); // up to and including @
    const rawQuery = input.slice(triggerIndex + 1, cursorPos);
    const after = input.slice(cursorPos);
    // Remove trailing slash, then trim to parent
    const trimmed = rawQuery.replace(/\/$/, "");
    const lastSlash = trimmed.lastIndexOf("/");
    const newQuery = lastSlash === -1 ? "" : trimmed.slice(0, lastSlash + 1);
    const newInput = before + newQuery + after;
    const newCursorPos = triggerIndex + 1 + newQuery.length;
    setInput(newInput);
    setCursorPos(newCursorPos);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      textareaRef.current?.focus();
    });
  }, [input, cursorPos, triggerIndex]);

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

  React.useImperativeHandle(
    ref,
    () => ({
      addFiles: (files: File[]) => {
        if (files.length === 0) return;
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        handleFileSelect(dt.files);
      },
    }),
    [handleFileSelect],
  );

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mention.navigateDown();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mention.navigateUp();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (mention.items.length > 0) {
          e.preventDefault();
          handleMentionSelect(mention.items[mention.selectedIndex]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mention.dismiss();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        data-testid="chat-file-input"
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
          {pendingFiles.map((file, i) => {
            const PendingIcon = getFileIcon(file.name);
            return (
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
                    <PendingIcon className="h-3 w-3 text-muted-foreground shrink-0" />
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
            );
          })}
        </div>
      )}
      <div className="relative flex gap-2 items-end">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          {mention.isOpen && (
            <FileMentionDropdown
              items={mention.items}
              selectedIndex={mention.selectedIndex}
              currentPath={mention.currentPath}
              isLoading={mention.isLoading}
              onSelect={handleMentionSelect}
              onNavigateBack={handleNavigateBack}
              onPreview={handleMentionPreview}
            />
          )}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCursorPos(e.target.selectionStart ?? 0);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
            }}
            onSelect={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
            placeholder="Type a message... (@ to reference files)"
            rows={1}
            className="min-h-0 resize-none"
            onKeyDown={handleKeyDown}
          />
        </div>
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
});
