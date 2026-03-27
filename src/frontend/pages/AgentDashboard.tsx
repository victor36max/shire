import * as React from "react";
import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useResolveProjectId, useAgents } from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import type { WsEvent } from "../lib/ws";
import AgentDashboardComponent from "../components/AgentDashboard";

type AgentData = NonNullable<ReturnType<typeof useAgents>["data"]>;

function updateAgent(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  agentId: string,
  patch: Partial<AgentData[number]>,
) {
  queryClient.setQueryData<AgentData>(["agents", projectId], (prev) =>
    prev?.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
  );
}

export default function AgentDashboardPage() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentName ? agentList.find((a) => a.name === agentName) : agentList[0];
  const selectedAgentId = selectedAgent?.id;

  // --- Streaming state ---
  const [streamingText, setStreamingText] = useState("");

  // Subscribe to agent list updates
  useSubscription(projectId ? `project:${projectId}:agents` : null, (event) => {
    const p = event.payload as Record<string, unknown>;
    const agentId = p.agentId as string;

    switch (event.type) {
      case "agent_busy":
        updateAgent(queryClient, projectId!, agentId, { busy: p.active as boolean });
        break;
      case "agent_status":
        updateAgent(queryClient, projectId!, agentId, {
          status: p.status as AgentData[number]["status"],
        });
        break;
      case "new_message_notification":
        if (agentId === selectedAgentId) {
          queryClient.invalidateQueries({ queryKey: ["messages", projectId, selectedAgentId] });
        }
        updateAgent(queryClient, projectId!, agentId, {
          unreadCount: (agentList.find((a) => a.id === agentId)?.unreadCount ?? 0) + 1,
        });
        break;
      case "agent_created":
      case "agent_deleted":
        queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
        break;
    }
  });

  // Subscribe to per-agent streaming events
  const handleAgentEvent = useCallback(
    (event: WsEvent) => {
      switch (event.type) {
        case "text_delta": {
          const delta = (event.payload as Record<string, unknown>)?.delta as string;
          if (delta) setStreamingText((prev) => prev + delta);
          break;
        }
        case "text":
        case "turn_complete": {
          // Final text arrived — flush streaming and refetch persisted messages
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
          // Refetch messages for any persisted event
          if (selectedAgentId) {
            queryClient.invalidateQueries({
              queryKey: ["messages", projectId, selectedAgentId],
            });
          }
          break;
        }
        case "agent_busy": {
          const p = event.payload as Record<string, unknown>;
          const agentId = p.agentId as string;
          if (agentId) {
            updateAgent(queryClient, projectId!, agentId, { busy: p.active as boolean });
          } else {
            console.warn("[AgentDashboard] agent_busy event missing agentId", event);
          }
          break;
        }
        case "agent_status": {
          const s = event.payload as { agentId: string; status: AgentData[number]["status"] };
          updateAgent(queryClient, projectId!, s.agentId, { status: s.status });
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

  // Reset streaming when switching agents (using ref to avoid setState-in-effect)
  const prevAgentIdRef = React.useRef(selectedAgentId);
  if (prevAgentIdRef.current !== selectedAgentId) {
    prevAgentIdRef.current = selectedAgentId;
    if (streamingText !== "") setStreamingText("");
  }

  if (!projectId) return <div className="p-8">Loading...</div>;

  return <AgentDashboardComponent streamingText={streamingText} />;
}
