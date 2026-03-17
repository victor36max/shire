import * as React from "react";
import AgentSidebar from "./AgentSidebar";
import AgentForm from "./AgentForm";
import ChatHeader from "./ChatHeader";
import ChatPanel, { type Message } from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import { type Agent, type BaseRecipe } from "./types";

interface AgentDashboardProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  messages?: Message[];
  hasMore?: boolean;
  loadingMore?: boolean;
  editAgent: Agent | null;
  baseRecipes?: BaseRecipe[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function AgentDashboard({
  agents,
  selectedAgent,
  messages = [],
  hasMore = false,
  loadingMore = false,
  editAgent,
  baseRecipes = [],
  pushEvent,
}: AgentDashboardProps) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);

  React.useEffect(() => {
    if (editAgent) {
      setCurrentAgent(editAgent);
      setEditingId(editAgent.id ?? null);
      setFormTitle("Edit Agent");
      setFormOpen(true);
    }
  }, [editAgent]);

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingId(null);
    setFormTitle("New Agent");
    setFormOpen(true);
  };

  const handleSelectAgent = (id: number) => {
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
    if (editingId) {
      pushEvent("update-agent", { id: editingId, ...payload });
    } else {
      pushEvent("create-agent", payload);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <AgentSidebar
        agents={agents}
        selectedAgentId={selectedAgent?.id ?? null}
        onSelectAgent={handleSelectAgent}
        onNewAgent={handleNew}
        onDeleteAgent={handleDeleteAgent}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {selectedAgent ? (
          <>
            <ChatHeader agent={selectedAgent} />
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
          <WelcomePanel onNewAgent={handleNew} />
        )}
      </div>

      <AgentForm
        open={formOpen}
        title={formTitle}
        agent={currentAgent}
        baseRecipes={baseRecipes}
        pushEvent={handleFormSave}
        onClose={handleFormClose}
      />
    </div>
  );
}
