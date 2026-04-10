import * as React from "react";
import { Spinner } from "./ui/spinner";
import { Button } from "./ui/button";
import Markdown from "./Markdown";
import { CopyButton } from "./CopyButton";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { useStickToBottom } from "use-stick-to-bottom";
import { Message, MessageContent, MessageActions } from "./ai-elements/message";
import { type AgentOverview } from "./types";
import { useProjectId, useMessages, useSendMessage, useUpdateAgentCache } from "../hooks";
import { messageTimeLabel, dateSeparatorLabel, isSameDay } from "../lib/time";
import { useTickingClock } from "../lib/useTickingClock";
import { Reasoning, ReasoningTrigger } from "./ai-elements/reasoning";
import { ToolCallMessage } from "./chat/ToolCallMessage";
import { InterAgentMessage } from "./chat/InterAgentMessage";
import { SystemMessage } from "./chat/SystemMessage";
import { AttachmentDisplay } from "./chat/AttachmentDisplay";
import { ChatInput } from "./chat/ChatInput";
import type { MessageRole } from "./ai-elements/types";

// Re-export types for backward compatibility with tests
export type { Attachment, Message } from "./chat/types";

/** Shape of a raw message from the API. */
interface RawMessage {
  id: number;
  role: string;
  content: Record<string, unknown>;
  createdAt: string;
}

/** Transform API messages to ChatPanel Message format */
function transformMessages(raw: RawMessage[]): Array<{
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
  attachments?: Array<{ id: string; filename: string; size: number; content_type: string }>;
}> {
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
      attachments: content.attachments as
        | Array<{ id: string; filename: string; size: number; content_type: string }>
        | undefined,
    };
  });
}

interface ChatPanelProps {
  agent: AgentOverview;
  streamingText?: string;
}

export default function ChatPanel({ agent, streamingText: externalStreamingText }: ChatPanelProps) {
  const { projectId, projectName } = useProjectId();
  const updateAgentCache = useUpdateAgentCache(projectId);
  const markBusy = React.useCallback(
    () => updateAgentCache(agent.id, { busy: true }),
    [updateAgentCache, agent.id],
  );

  const {
    data: messagesData,
    isLoading: messagesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(projectId, agent.id);
  const sendMessage = useSendMessage(projectId ?? "");

  const messages = React.useMemo(() => {
    if (!messagesData) return [];
    const allRaw = [...messagesData.pages].reverse().flatMap((page) => page.messages);
    return transformMessages(allRaw);
  }, [messagesData]);
  const hasMore = hasNextPage ?? false;
  const loadingMore = isFetchingNextPage;

  const streamingText = externalStreamingText ?? "";

  // Infinite scroll sentinel
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && messages.length > 0) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, fetchNextPage, messages.length]);

  const stickyInstance = useStickToBottom({ initial: "instant", resize: "instant" });

  useTickingClock(60_000);

  const hasMessages = messages.length > 0 || streamingText.length > 0;

  return (
    <div className="flex flex-col h-full relative">
      <Conversation instance={stickyInstance}>
        <ConversationContent>
          <div ref={sentinelRef} className="h-px" />
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
                        stickyInstance.scrollToBottom();
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
          {messages.map((msg, i) => {
            const prevMsg = i > 0 ? messages[i - 1] : null;
            const showSeparator = !prevMsg || !isSameDay(prevMsg.ts, msg.ts);
            const key = msg.id ?? `msg-${i}`;

            return (
              <React.Fragment key={key}>
                {showSeparator && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-xs text-muted-foreground px-2">
                      {dateSeparatorLabel(msg.ts)}
                    </span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                )}
                {msg.role === "tool_use" ? (
                  <ToolCallMessage msg={msg} />
                ) : msg.role === "inter_agent" ? (
                  <InterAgentMessage msg={msg} />
                ) : msg.role === "system" ? (
                  <SystemMessage msg={msg} />
                ) : (
                  <Message from={msg.role as MessageRole}>
                    <MessageContent>
                      {msg.text ? <Markdown>{msg.text}</Markdown> : null}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <AttachmentDisplay
                          attachments={msg.attachments}
                          projectName={projectName}
                          agentId={agent.id}
                        />
                      )}
                    </MessageContent>
                    <MessageActions>
                      <span className="text-xs text-muted-foreground">
                        {messageTimeLabel(msg.ts)}
                      </span>
                      {msg.role === "agent" && msg.text && <CopyButton text={msg.text} />}
                    </MessageActions>
                  </Message>
                )}
              </React.Fragment>
            );
          })}
          {streamingText && (
            <Message from="assistant">
              <MessageContent>
                <Markdown>{streamingText}</Markdown>
              </MessageContent>
            </Message>
          )}
          {agent.busy && !streamingText && (
            <Reasoning isStreaming={true}>
              <ReasoningTrigger />
            </Reasoning>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <ChatInput agent={agent} onMessageSent={stickyInstance.scrollToBottom} />
    </div>
  );
}
