import * as React from "react";
import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "./ui/spinner";
import { ErrorState } from "./ui/error-state";
import ChatHeader from "./ChatHeader";
import ChatPanel from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import {
  useAgents,
  useMessages,
  useMarkRead,
  useUpdateAgentCache,
  findDefaultAgent,
} from "../hooks";
import { useSubscription } from "../hooks/ws";
import type { AgentWsEvent } from "../lib/ws";
import { useProjectLayout } from "../providers/ProjectLayoutProvider";
import { insertMessageIntoCache } from "../lib/insert-message-into-cache";

export default function AgentChatView() {
  const { agentName } = useParams();
  const { projectId, sidebarOpen, setSidebarOpen, onNewAgent, onBrowseCatalog } =
    useProjectLayout();
  const queryClient = useQueryClient();
  const updateAgentCache = useUpdateAgentCache(projectId);

  const {
    data: agentList = [],
    isLoading: agentsLoading,
    isError: agentsError,
    error: agentsErrorObj,
    refetch: refetchAgents,
  } = useAgents(projectId);
  const selectedAgent = agentName
    ? agentList.find((a) => a.name === agentName)
    : (findDefaultAgent(agentList) ?? agentList[0]);
  const selectedAgentId = selectedAgent?.id;

  const { data: messagesData } = useMessages(projectId, selectedAgentId);
  const markRead = useMarkRead(projectId ?? "");

  // --- Streaming state ---
  const [streamingText, setStreamingText] = useState("");

  // Subscribe to per-agent streaming events (agent_busy is
  // handled by ProjectLayout's project-level subscription, not here)
  const handleAgentEvent = useCallback(
    (event: AgentWsEvent) => {
      if (!projectId || !selectedAgentId) return;

      // Optimistically insert the message into the cache if the event carries one,
      // so it appears instantly without waiting for a refetch round-trip.
      if ("message" in event && event.message) {
        insertMessageIntoCache(queryClient, projectId, selectedAgentId, event.message);
      }

      switch (event.type) {
        case "text_delta": {
          const { delta } = event.payload;
          if (delta) setStreamingText((prev) => prev + delta);
          break;
        }
        case "text": {
          setStreamingText("");
          // Background refetch to reconcile with server state
          queryClient.invalidateQueries({
            queryKey: ["messages", projectId, selectedAgentId],
          });
          break;
        }
        case "turn_complete": {
          setStreamingText("");
          queryClient.invalidateQueries({
            queryKey: ["messages", projectId, selectedAgentId],
          });
          break;
        }
        case "tool_use":
        case "tool_result":
        case "inter_agent_message":
        case "attachment":
        case "error":
        case "system_message": {
          queryClient.invalidateQueries({
            queryKey: ["messages", projectId, selectedAgentId],
          });
          break;
        }
      }
    },
    [projectId, selectedAgentId, queryClient],
  );

  useSubscription(
    projectId && selectedAgentId ? `project:${projectId}:agent:${selectedAgentId}` : null,
    handleAgentEvent,
  );

  // Reset streaming when switching agents
  const prevAgentIdRef = React.useRef(selectedAgentId);
  if (prevAgentIdRef.current !== selectedAgentId) {
    prevAgentIdRef.current = selectedAgentId;
    if (streamingText !== "") setStreamingText("");
  }

  // Mark messages as read when viewing an agent
  // Page 0 = most recent page (no cursor); last element = newest message
  const lastMessageId = messagesData?.pages?.[0]?.messages?.at(-1)?.id as number | undefined;
  const markReadRef = React.useRef(markRead);
  React.useEffect(() => {
    markReadRef.current = markRead;
  });
  React.useEffect(() => {
    if (!projectId || !selectedAgentId || !lastMessageId) return;
    markReadRef.current.mutate({ agentId: selectedAgentId, messageId: lastMessageId });
    updateAgentCache(selectedAgentId, { unreadCount: 0 });
  }, [projectId, selectedAgentId, lastMessageId, updateAgentCache]);

  if (selectedAgent) {
    return (
      <>
        <ChatHeader agent={selectedAgent} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex-1 min-h-0">
          <ChatPanel key={selectedAgent.id} agent={selectedAgent} streamingText={streamingText} />
        </div>
      </>
    );
  }

  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (agentsError) {
    return (
      <div className="flex items-center justify-center flex-1">
        <ErrorState
          message={agentsErrorObj?.message || "Failed to load agents"}
          onRetry={() => refetchAgents()}
        />
      </div>
    );
  }

  return (
    <WelcomePanel
      onNewAgent={onNewAgent}
      onBrowseCatalog={onBrowseCatalog}
      onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
      hasAgents={agentList.length > 0}
    />
  );
}
