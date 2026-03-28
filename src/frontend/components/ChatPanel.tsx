import * as React from "react";
import { Paperclip, Square, X, FileIcon, Download } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import Markdown from "./Markdown";
import { type AgentOverview } from "./types";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProjectId,
  useAgents,
  useMessages,
  useSendMessage,
  useInterruptAgent,
  useRestartAgent,
} from "../lib/hooks";

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

interface PendingFile {
  name: string;
  size: number;
  base64: string;
  content_type: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AttachmentDisplay = React.memo(function AttachmentDisplay({
  attachments,
  projectName,
  agentId,
}: {
  attachments: Attachment[];
  projectName: string;
  agentId: string;
}) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((att) => {
        const url = `/api/projects/${projectName}/agents/${agentId}/attachments/${att.id}/${att.filename}`;
        const isImage = att.content_type.startsWith("image/");

        return isImage ? (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border border-border overflow-hidden hover:opacity-90 transition-opacity"
          >
            <img
              src={url}
              alt={att.filename}
              loading="lazy"
              className="max-w-48 max-h-32 object-cover"
            />
          </a>
        ) : (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted/50 text-sm"
          >
            <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-40">{att.filename}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({formatFileSize(att.size)})
            </span>
            <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
});

const ToolCallMessage = React.memo(function ToolCallMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);
  const inputStr = msg.input ? JSON.stringify(msg.input, null, 2) : "";
  const hasOutput = msg.output != null;

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-lg"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <Badge variant="outline" className="font-mono text-xs">
          {msg.tool}
        </Badge>
        {hasOutput ? (
          <Badge variant={msg.isError ? "destructive" : "secondary"} className="text-xs">
            {msg.isError ? "error" : "done"}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground animate-pulse">running...</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {inputStr && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Input</div>
              <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/50 rounded p-2 max-h-40 overflow-y-auto">
                {inputStr}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Output</div>
              <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/50 rounded p-2 max-h-40 overflow-y-auto">
                {msg.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const InterAgentMessage = React.memo(function InterAgentMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 rounded-lg italic"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="text-muted-foreground">Message from {msg.fromAgent}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <Markdown>{msg.text ?? ""}</Markdown>
        </div>
      )}
    </div>
  );
});

const SystemMessage = React.memo(function SystemMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="max-w-[80%] rounded-lg border border-border text-sm w-fit">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left italic h-auto justify-start"
      >
        <span className="text-muted-foreground">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="text-muted-foreground">System notification</span>
      </Button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <Markdown>{msg.text ?? ""}</Markdown>
        </div>
      )}
    </div>
  );
});

/** Shape of a raw message from the API. */
interface RawMessage {
  id: number;
  role: string;
  content: Record<string, unknown>;
  createdAt: string;
}

/** Transform API messages to ChatPanel Message format */
function transformMessages(raw: RawMessage[]): Message[] {
  return raw.map((m) => {
    const { content } = m;
    return {
      id: m.id,
      role: m.role,
      ts: m.createdAt,
      text: content.text as string | undefined,
      tool: content.tool as string | undefined,
      tool_use_id: content.tool_use_id as string | undefined,
      input: content.input as Record<string, unknown> | undefined,
      output: content.output as string | null | undefined,
      isError: content.isError as boolean | undefined,
      fromAgent: content.fromAgent as string | undefined,
      attachments: content.attachments as Attachment[] | undefined,
    };
  });
}

interface ChatPanelProps {
  agent: AgentOverview;
  streamingText?: string;
}

export default function ChatPanel({ agent, streamingText: externalStreamingText }: ChatPanelProps) {
  const { projectId, projectName } = useProjectId();
  const queryClient = useQueryClient();

  type AgentList = NonNullable<ReturnType<typeof useAgents>["data"]>;
  const markBusy = () =>
    queryClient.setQueryData<AgentList>(["agents", projectId], (prev) =>
      prev?.map((a) => (a.id === agent.id ? { ...a, busy: true } : a)),
    );

  const {
    data: messagesData,
    isLoading: messagesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(projectId, agent.id);
  const sendMessage = useSendMessage(projectId ?? "");
  const interruptAgent = useInterruptAgent(projectId ?? "");
  const restartAgent = useRestartAgent(projectId ?? "");

  const messages = React.useMemo(() => {
    if (!messagesData) return [];
    // Page 0 = newest (no cursor), page N = oldest. Reverse for chronological order.
    const allRaw = [...messagesData.pages].reverse().flatMap((page) => page.messages);
    return transformMessages(allRaw);
  }, [messagesData]);
  const hasMore = hasNextPage ?? false;
  const loadingMore = isFetchingNextPage;

  const [input, setInput] = React.useState("");
  const [streamingText, setStreamingText] = React.useState("");
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = React.useRef(0);
  const prevScrollHeightRef = React.useRef(0);
  const initialScrollDone = React.useRef(false);

  // Reset state when switching agents
  React.useEffect(() => {
    setStreamingText("");
    initialScrollDone.current = false;
    prevMessagesLengthRef.current = 0;
    prevScrollHeightRef.current = 0;
  }, [agent.id]);

  // Sync streaming text from parent (via WebSocket subscription)
  React.useEffect(() => {
    setStreamingText(externalStreamingText ?? "");
  }, [externalStreamingText]);

  // Auto-scroll to bottom on initial load and new messages
  React.useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    const container = scrollContainerRef.current;

    if (container && messages.length > 0) {
      if (!initialScrollDone.current) {
        // Initial load — scroll to bottom immediately
        initialScrollDone.current = true;
        messagesEndRef.current?.scrollIntoView();
      } else if (messages.length > prevLen) {
        const prevScrollHeight = prevScrollHeightRef.current;
        if (
          prevScrollHeight > 0 &&
          container.scrollHeight > prevScrollHeight &&
          container.scrollTop < 50
        ) {
          // Preserve scroll position after prepending older messages
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        } else {
          // New message at the end — scroll to bottom
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Auto-scroll during streaming (instant to avoid animation queue buildup)
  React.useEffect(() => {
    if (streamingText && initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView();
    }
  }, [streamingText]);

  // Scroll to bottom when busy state changes (thinking indicator appears/disappears)
  React.useEffect(() => {
    if (agent.busy && initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [agent.busy]);

  // Save scroll height before render for scroll position preservation
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
    }
  });

  // Infinite scroll: load more when scrolled to top
  const handleScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore || loadingMore) return;
    if (container.scrollTop === 0 && messages.length > 0) {
      fetchNextPage();
    }
  }, [hasMore, loadingMore, fetchNextPage, messages.length]);

  const handleFileSelect = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setPendingFiles((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            base64,
            content_type: file.type || "application/octet-stream",
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    // Reset so the same file can be selected again
    e.target.value = "";
  }, []);

  const removePendingFile = React.useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;

    const attachments =
      pendingFiles.length > 0
        ? pendingFiles.map((f) => ({
            name: f.name,
            content: f.base64,
            content_type: f.content_type,
          }))
        : undefined;

    markBusy();
    sendMessage.mutate({ agentId: agent.id, text: text || "", attachments });
    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const hasMessages = messages.length > 0 || streamingText.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {loadingMore && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-muted-foreground animate-pulse">
              Loading older messages...
            </span>
          </div>
        )}
        {messagesLoading && (
          <div className="flex items-center justify-center h-full">
            <Spinner size="md" className="text-muted-foreground" />
          </div>
        )}
        {!messagesLoading && !hasMessages && (
          <div className="flex flex-col items-center justify-center h-full gap-4 max-w-sm mx-auto text-center">
            <p className="text-sm text-muted-foreground">
              Send a message to start working with this agent.
            </p>
            {agent.status === "active" && (
              <div className="flex flex-wrap justify-center gap-2">
                {["What can you help me with?", "What tools do you have?"].map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      markBusy();
                      sendMessage.mutate({ agentId: agent.id, text: suggestion });
                    }}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((msg, i) =>
          msg.role === "tool_use" ? (
            <ToolCallMessage key={msg.id ?? `msg-${i}`} msg={msg} />
          ) : msg.role === "inter_agent" ? (
            <InterAgentMessage key={msg.id ?? `msg-${i}`} msg={msg} />
          ) : msg.role === "system" ? (
            <SystemMessage key={msg.id ?? `msg-${i}`} msg={msg} />
          ) : (
            <div
              key={msg.id ?? `msg-${i}`}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-3 py-1.5 rounded-lg text-sm w-fit max-w-[80%] ${
                  msg.role === "user" ? "bg-primary/10 text-foreground" : "bg-muted"
                }`}
              >
                {msg.text ? <Markdown>{msg.text}</Markdown> : null}
                {msg.attachments && msg.attachments.length > 0 && (
                  <AttachmentDisplay
                    attachments={msg.attachments}
                    projectName={projectName}
                    agentId={agent.id}
                  />
                )}
              </div>
            </div>
          ),
        )}
        {streamingText && (
          <div className="flex justify-start">
            <div className="px-3 py-1.5 rounded-lg text-sm w-fit max-w-[80%] bg-muted">
              <Markdown>{streamingText}</Markdown>
            </div>
          </div>
        )}
        {agent.busy && !streamingText && (
          <div
            className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-status-active animate-pulse"
              aria-hidden="true"
            />
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {agent.status === "active" ? (
        <div className="border-t border-border p-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingFiles.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-muted/50 text-xs"
                >
                  <FileIcon className="h-3 w-3 text-muted-foreground" />
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
              <Button onClick={handleSend} disabled={sendMessage.isPending}>
                Send
              </Button>
            )}
          </div>
        </div>
      ) : agent.status === "idle" ? (
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
      ) : null}
    </div>
  );
}
