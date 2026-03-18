import * as React from "react";
import AgentSidebar from "./AgentSidebar";
import AgentForm from "./AgentForm";
import ChatHeader from "./ChatHeader";
import ChatPanel, { type Message } from "./ChatPanel";
import WelcomePanel from "./WelcomePanel";
import { type Agent } from "./types";

interface AgentDashboardProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  messages?: Message[];
  hasMore?: boolean;
  loadingMore?: boolean;
  editAgent: Agent | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function AgentDashboard({
  agents,
  selectedAgent,
  messages = [],
  hasMore = false,
  loadingMore = false,
  editAgent,
  pushEvent,
}: AgentDashboardProps) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingName, setEditingName] = React.useState<string | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<Agent | null>(null);

  React.useEffect(() => {
    if (editAgent) {
      setCurrentAgent(editAgent);
      setEditingName(editAgent.name ?? null);
      setFormTitle("Edit Agent");
      setFormOpen(true);
    }
  }, [editAgent]);

  const handleNew = () => {
    setCurrentAgent(null);
    setEditingName(null);
    setFormTitle("New Agent");
    setFormOpen(true);
  };

  const handleSelectAgent = (name: string) => {
    pushEvent("select-agent", { name });
  };

  const handleDeleteAgent = (agent: Agent) => {
    pushEvent("delete-agent", { name: agent.name });
  };

  const handleFormClose = () => {
    setFormOpen(false);
  };

  const handleFormSave = (_event: string, payload: Record<string, unknown>) => {
    setFormOpen(false);
    if (editingName) {
      pushEvent("update-agent", { name: editingName, ...payload });
    } else {
      pushEvent("create-agent", payload);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <AgentSidebar
        agents={agents}
        selectedAgentName={selectedAgent?.name ?? null}
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
        pushEvent={handleFormSave}
        onClose={handleFormClose}
      />
    </div>
  );
}
