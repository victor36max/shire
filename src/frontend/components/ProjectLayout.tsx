import * as React from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AgentSidebar from "./AgentSidebar";
import AgentForm from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import { type Agent, type CatalogAgent } from "./types";
import {
  useResolveProjectId,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useCatalogAgent,
} from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import {
  ProjectLayoutProvider,
  type ProjectLayoutContextValue,
} from "../providers/ProjectLayoutProvider";

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

export default function ProjectLayout() {
  const { projectName, agentName } = useParams();
  const queryClient = useQueryClient();
  const projectId = useResolveProjectId(projectName);

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentName ? agentList.find((a) => a.name === agentName) : agentList[0];
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
      const agent = catalogSelectedAgent as unknown as CatalogAgent;
      setCatalogOpen(false);
      setCurrentAgent({
        id: "",
        name: agent.name,
        description: agent.description,
        harness: agent.harness,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        status: "idle",
        busy: false,
        unreadCount: 0,
      });
      setEditingAgent(null);
      setFormTitle("New Agent from Catalog");
      setFormOpen(true);
      setSelectedCatalogName(undefined);
    }
  }, [catalogSelectedAgent]);

  // Subscribe to project-level agent list updates
  useSubscription(projectId ? `project:${projectId}:agents` : null, (event) => {
    const p = event.payload as Record<string, unknown>;
    const agentId = p.agentId as string;

    switch (event.type) {
      case "agent_busy":
        updateAgentCache(queryClient, projectId!, agentId, { busy: p.active as boolean });
        break;
      case "agent_status":
        updateAgentCache(queryClient, projectId!, agentId, {
          status: p.status as AgentData[number]["status"],
        });
        break;
      case "new_message_notification":
        if (agentId === selectedAgentId) {
          queryClient.invalidateQueries({ queryKey: ["messages", projectId, selectedAgentId] });
        } else {
          const cached = queryClient.getQueryData<AgentData>(["agents", projectId]);
          const current = cached?.find((a) => a.id === agentId)?.unreadCount ?? 0;
          updateAgentCache(queryClient, projectId!, agentId, { unreadCount: current + 1 });
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

  const handleFormSave = (_event: string, payload: Record<string, unknown>) => {
    setFormOpen(false);
    if (editingAgent) {
      const { id: _id, ...fields } = payload;
      updateAgent.mutate({ id: editingAgent.id, ...fields });
    } else {
      createAgent.mutate(payload as Parameters<typeof createAgent.mutate>[0]);
    }
  };

  const contextValue: ProjectLayoutContextValue = {
    projectId,
    sidebarOpen,
    setSidebarOpen,
    onNewAgent: handleNew,
    onBrowseCatalog: handleBrowseCatalog,
  };

  if (!projectId) return <div className="p-8">Loading...</div>;

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
