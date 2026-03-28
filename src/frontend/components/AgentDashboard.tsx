import * as React from "react";
import { useParams } from "react-router-dom";
import AgentSidebar from "./AgentSidebar";
import AgentForm from "./AgentForm";
import CatalogBrowser from "./CatalogBrowser";
import ChatHeader from "./ChatHeader";
import ChatPanel from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import { Loader2 } from "lucide-react";
import { type Agent, type CatalogAgent } from "./types";
import {
  useProjectId,
  useAgents,
  useCreateAgent,
  useUpdateAgent,
  useCatalogAgent,
} from "../lib/hooks";

interface AgentDashboardProps {
  streamingText?: string;
}

export default function AgentDashboard({ streamingText }: AgentDashboardProps) {
  const { agentName } = useParams<{ agentName: string }>();
  const { projectId } = useProjectId();
  const { data: agentList = [], isLoading: agentsLoading } = useAgents(projectId);

  const selectedAgent = agentName ? agentList.find((a) => a.name === agentName) : agentList[0];

  const createAgent = useCreateAgent(projectId ?? "");
  const updateAgent = useUpdateAgent(projectId ?? "");

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

  React.useEffect(() => {
    setSidebarOpen(false);
  }, [selectedAgent?.id]);

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

      <div className="flex-1 flex flex-col min-w-0">
        {selectedAgent ? (
          <>
            <ChatHeader agent={selectedAgent} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
            <div className="flex-1 min-h-0">
              <ChatPanel agent={selectedAgent} streamingText={streamingText} />
            </div>
          </>
        ) : agentsLoading ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <WelcomePanel
            onNewAgent={handleNew}
            onBrowseCatalog={handleBrowseCatalog}
            onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
            hasAgents={agentList.length > 0}
          />
        )}
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
