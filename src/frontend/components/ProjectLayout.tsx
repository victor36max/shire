import * as React from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "./ui/spinner";
import AgentSidebar from "./AgentSidebar";
import AgentForm, { type AgentFormPayload } from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import { type Agent, type AgentListResponse } from "./types";
import {
  useResolveProjectId,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useUpdateAgentCache,
  useCatalogAgent,
} from "../hooks";
import { useSubscription, type AgentListWsEvent } from "../lib/ws";
import {
  ProjectLayoutProvider,
  type ProjectLayoutContextValue,
} from "../providers/ProjectLayoutProvider";

export default function ProjectLayout() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);
  const updateAgentCache = useUpdateAgentCache(projectId);

  const { data: agentData } = useAgents(projectId);
  const agentList = agentData?.agents ?? [];
  const defaultAgentId = agentData?.defaultAgentId;
  const selectedAgent = agentName
    ? agentList.find((a) => a.name === agentName)
    : (agentList.find((a) => a.id === defaultAgentId) ?? agentList[0]);
  const selectedAgentId = selectedAgent?.id;

  const createAgent = useCreateAgent(projectId ?? "");
  const updateAgent = useUpdateAgent(projectId ?? "");

  // --- Modal state ---
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingAgent, setEditingAgent] = React.useState<Agent | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [selectedCatalogName, setSelectedCatalogName] = React.useState<string | undefined>(
    undefined,
  );

  const { data: catalogSelectedAgent } = useCatalogAgent(selectedCatalogName);

  // Close mobile sidebar when agent changes
  React.useEffect(() => {
    setSidebarOpen(false);
  }, [selectedAgentId]);

  React.useEffect(() => {
    if (catalogSelectedAgent) {
      setCatalogOpen(false);
      setCurrentAgent({
        id: "",
        name: catalogSelectedAgent.name,
        description: catalogSelectedAgent.description,
        harness: catalogSelectedAgent.harness,
        model: catalogSelectedAgent.model,
        systemPrompt: catalogSelectedAgent.systemPrompt,
        skills: [],
        status: "idle",
        busy: false,
        unreadCount: 0,
        lastUserMessageAt: null,
      });
      setEditingAgent(null);
      setFormTitle("New Agent from Catalog");
      setFormOpen(true);
      setSelectedCatalogName(undefined);
    }
  }, [catalogSelectedAgent]);

  // Subscribe to project-level agent list updates
  useSubscription<AgentListWsEvent>(projectId ? `project:${projectId}:agents` : null, (event) => {
    switch (event.type) {
      case "agent_busy":
        updateAgentCache(event.payload.agentId, {
          busy: event.payload.active,
        });
        break;
      case "agent_status":
        updateAgentCache(event.payload.agentId, {
          status: event.payload.status,
        });
        break;
      case "new_message_notification":
        if (event.payload.agentId === selectedAgentId) {
          queryClient.invalidateQueries({
            queryKey: ["messages", projectId, selectedAgentId],
          });
        } else {
          const cached = queryClient.getQueryData<AgentListResponse>(["agents", projectId]);
          const current =
            cached?.agents.find((a) => a.id === event.payload.agentId)?.unreadCount ?? 0;
          updateAgentCache(event.payload.agentId, {
            unreadCount: current + 1,
          });
        }
        break;
      case "agent_created":
      case "agent_deleted":
        queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
        break;
    }
  });

  const handleBrowseCatalog = () => {
    setCatalogOpen(true);
  };

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingAgent(null);
    setFormTitle("New Agent");
    setFormOpen(true);
  };

  const handleFormSave = (_event: string, payload: AgentFormPayload) => {
    setFormOpen(false);
    if (editingAgent) {
      const { id: _id, ...fields } = payload;
      updateAgent.mutate({ id: editingAgent.id, ...fields });
    } else {
      createAgent.mutate(payload);
    }
  };

  const contextValue: ProjectLayoutContextValue = {
    projectId,
    sidebarOpen,
    setSidebarOpen,
    onNewAgent: handleNew,
    onBrowseCatalog: handleBrowseCatalog,
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
        </div>
      )}

      <div
        className={`fixed top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)] z-50 w-64 transition-transform duration-200 md:static md:inset-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AgentSidebar onNewAgent={handleNew} onBrowseCatalog={handleBrowseCatalog} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <ProjectLayoutProvider value={contextValue} />
      </div>

      <AgentForm
        open={formOpen}
        title={formTitle}
        agent={currentAgent}
        onSave={handleFormSave}
        onClose={() => setFormOpen(false)}
      />

      <CatalogBrowser
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdd={(name) => setSelectedCatalogName(name)}
      />
    </div>
  );
}
