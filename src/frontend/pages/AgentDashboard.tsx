import * as React from "react";
import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useResolveProjectId, useAgents } from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import type { WsEvent } from "../lib/ws";
import AgentDashboardComponent from "../components/AgentDashboard";

export default function AgentDashboardPage() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentName ? agentList.find((a) => a.name === agentName) : agentList[0];
  const selectedAgentId = selectedAgent?.id;

  // --- Streaming state ---
  const [streamingText, setStreamingText] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Subscribe to agent list updates
  useSubscription(projectId ? `project:${projectId}:agents` : null, (event) => {
    queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
    if (event.type === "agent_busy") {
      const p = event.payload as { agentId: string; active: boolean };
      if (p.agentId === selectedAgentId) {
        setIsBusy(p.active);
      }
    }
    if (event.type === "new_message_notification") {
      const p = event.payload as { agentId: string };
      if (p.agentId === selectedAgentId) {
        queryClient.invalidateQueries({ queryKey: ["messages", projectId, selectedAgentId] });
      }
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
        case "processing": {
          const active = (event.payload as Record<string, unknown>)?.active as boolean;
          setIsBusy(active);
          break;
        }
        case "agent_status": {
          queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
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
    if (isBusy) setIsBusy(false);
  }

  if (!projectId) return <div className="p-8">Loading...</div>;

  return (
    <AgentDashboardComponent streamingText={streamingText} isBusy={isBusy} onSetBusy={setIsBusy} />
  );
}
