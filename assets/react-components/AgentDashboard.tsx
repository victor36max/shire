import * as React from "react";
import AgentSidebar from "./AgentSidebar";
import AgentForm from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import ChatHeader from "./ChatHeader";
import ChatPanel, { type Message } from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import { type Agent, type CatalogAgent, type CatalogAgentSummary, type CatalogCategory, type Project } from "./types";

interface AgentDashboardProps {
  project: { id: string; name: string };
  projects: Project[];
  agents: Agent[];
  selectedAgent: Agent | null;
  messages?: Message[];
  hasMore?: boolean;
  loadingMore?: boolean;
  editAgent: Agent | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
  catalogAgents?: CatalogAgentSummary[];
  catalogCategories?: CatalogCategory[];
  catalogSelectedAgent?: CatalogAgent | null;
}

export default function AgentDashboard({
  project,
  projects,
  agents,
  selectedAgent,
  messages = [],
  hasMore = false,
  loadingMore = false,
  editAgent,
  pushEvent,
  catalogAgents = [],
  catalogCategories = [],
  catalogSelectedAgent = null,
}: AgentDashboardProps) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingAgent, setEditingAgent] = React.useState<Agent | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Close mobile sidebar when the selected agent changes (e.g. server-driven navigation)
  React.useEffect(() => {
    setSidebarOpen(false);
  }, [selectedAgent?.id]);

  React.useEffect(() => {
    if (editAgent) {
      setCurrentAgent(editAgent);
      setEditingAgent(editAgent);
      setFormTitle("Edit Agent");
      setFormOpen(true);
    }
  }, [editAgent]);

  React.useEffect(() => {
    if (catalogSelectedAgent) {
      setCatalogOpen(false);
      setCurrentAgent({
        id: "",
        name: catalogSelectedAgent.name,
        description: catalogSelectedAgent.description,
        harness: catalogSelectedAgent.harness,
        model: catalogSelectedAgent.model,
        system_prompt: catalogSelectedAgent.system_prompt,
        skills: [],
        status: "idle",
      });
      setEditingAgent(null);
      setFormTitle("New Agent from Catalog");
      setFormOpen(true);
    }
  }, [catalogSelectedAgent]);

  const handleBrowseCatalog = () => setCatalogOpen(true);

  const handleCatalogAdd = (agentName: string) => {
    pushEvent("get-catalog-agent", { name: agentName });
  };

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingAgent(null);
    setFormTitle("New Agent");
    setFormOpen(true);
  };

  const handleSelectAgent = (id: string) => {
    setSidebarOpen(false);
    pushEvent("select-agent", { id });
  };

  const handleDeleteAgent = (agent: Agent) => {
    pushEvent("delete-agent", { id: agent.id });
  };

  const handleFormClose = () => {
    setFormOpen(false);
  };

  const handleFormSave = (_event: string, payload: Record<string, unknown>) => {
    setFormOpen(false);
    if (editingAgent) {
      pushEvent("update-agent", { id: editingAgent.id, ...payload });
    } else {
      pushEvent("create-agent", payload);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-background/80" />
        </div>
      )}

      {/* Sidebar — always visible on md+, slide-in overlay on mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AgentSidebar
          project={project}
          projects={projects}
          agents={agents}
          selectedAgentId={selectedAgent?.id ?? null}
          onSelectAgent={handleSelectAgent}
          onNewAgent={handleNew}
          onDeleteAgent={handleDeleteAgent}
          onBrowseCatalog={handleBrowseCatalog}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {selectedAgent ? (
          <>
            <ChatHeader agent={selectedAgent} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
            <div className="flex-1 min-h-0">
              <ChatPanel
                agent={selectedAgent}
                messages={messages}
                hasMore={hasMore}
                loadingMore={loadingMore}
                pushEvent={pushEvent}
              />
            </div>
          </>
        ) : (
          <WelcomePanel onNewAgent={handleNew} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        )}
      </div>

      <AgentForm
        open={formOpen}
        title={formTitle}
        agent={currentAgent}
        pushEvent={handleFormSave}
        onClose={handleFormClose}
      />

      <CatalogBrowser
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        agents={catalogAgents}
        categories={catalogCategories}
        onAdd={handleCatalogAdd}
      />
    </div>
  );
}
