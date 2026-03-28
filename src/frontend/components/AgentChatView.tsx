import * as React from "react";
import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import ChatHeader from "./ChatHeader";
import ChatPanel from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import { useAgents, useMessages, useMarkRead } from "../lib/hooks";
import { useSubscription, type AgentWsEvent } from "../lib/ws";
import { useProjectLayout } from "../providers/ProjectLayoutProvider";

type AgentData = NonNullable<ReturnType<typeof useAgents>["data"]>;

function updateAgentCache(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  agentId: string,
  patch: Partial<AgentData[number]>,
) {
  queryClient.setQueryData<AgentData>(["agents", projectId], (prev) =>
    prev?.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
  );
}

export default function AgentChatView() {
  const { agentName } = useParams();
  const { projectId, sidebarOpen, setSidebarOpen, onNewAgent, onBrowseCatalog } =
    useProjectLayout();
  const queryClient = useQueryClient();

  const { data: agentList = [], isLoading: agentsLoading } = useAgents(projectId);
  const selectedAgent = agentName ? agentList.find((a) => a.name === agentName) : agentList[0];
  const selectedAgentId = selectedAgent?.id;

  const { data: messagesData } = useMessages(projectId, selectedAgentId);
  const markRead = useMarkRead(projectId ?? "");

  // --- Streaming state ---
  const [streamingText, setStreamingText] = useState("");

  // Subscribe to per-agent streaming events (agent_busy/agent_status are
  // handled by ProjectLayout's project-level subscription, not here)
  const handleAgentEvent = useCallback(
    (event: AgentWsEvent) => {
      switch (event.type) {
        case "text_delta": {
          const { delta } = event.payload;
          if (delta) setStreamingText((prev) => prev + delta);
          break;
        }
        case "text":
        case "turn_complete": {
          setStreamingText("");
          if (selectedAgentId) {
            queryClient.invalidateQueries({
              queryKey: ["messages", projectId, selectedAgentId],
            });
          }
          break;
        }
        case "tool_use":
        case "tool_result":
        case "inter_agent_message":
        case "attachment":
        case "error":
        case "system_message": {
          if (selectedAgentId) {
            queryClient.invalidateQueries({
              queryKey: ["messages", projectId, selectedAgentId],
            });
          }
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
  const lastMessageId = messagesData?.messages?.at(-1)?.id;
  const markReadRef = React.useRef(markRead);
  React.useEffect(() => {
    markReadRef.current = markRead;
  });
  React.useEffect(() => {
    if (!projectId || !selectedAgentId || !lastMessageId) return;
    markReadRef.current.mutate({ agentId: selectedAgentId, messageId: lastMessageId });
    updateAgentCache(queryClient, projectId, selectedAgentId, { unreadCount: 0 });
  }, [projectId, selectedAgentId, lastMessageId, queryClient]);

  if (selectedAgent) {
    return (
      <>
        <ChatHeader agent={selectedAgent} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex-1 min-h-0">
          <ChatPanel agent={selectedAgent} streamingText={streamingText} />
        </div>
      </>
    );
  }

  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
