import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useProjectId, useAgents } from "../../hooks";

interface AgentListPanelProps {
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
}

export default function AgentListPanel({ onNewAgent, onBrowseCatalog }: AgentListPanelProps) {
  const navigate = useNavigate();
  const { agentName } = useParams<{ agentName: string }>();
  const { projectId, projectName } = useProjectId();
  const { data: agents = [], isLoading: agentsLoading } = useAgents(projectId);

  const selectedAgentId = agentName ? (agents.find((a) => a.name === agentName)?.id ?? null) : null;

  const handleSelectAgent = (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (agent) {
      navigate(`/projects/${projectName}/agents/${agent.name}`);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto py-1">
        {agentsLoading && (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" className="text-muted-foreground" />
          </div>
        )}
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`flex items-center gap-2 px-3 py-2 mx-1 rounded-md text-sm w-[calc(100%-0.5rem)] min-w-0 text-left ${
              selectedAgentId === agent.id
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted text-foreground"
            }`}
            onClick={() => handleSelectAgent(agent.id)}
          >
            <span className="shrink-0">{agent.emoji || "\u{1F916}"}</span>
            <span className="truncate flex-1">{agent.name}</span>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {agent.busy && (
                <span
                  className="relative flex h-2 w-2"
                  role="status"
                  aria-label="Processing"
                  title="Processing"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
              )}
              {agent.unreadCount > 0 && (
                <span className="min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center px-1">
                  {agent.unreadCount > 99 ? "99+" : agent.unreadCount}
                </span>
              )}
            </div>
          </button>
        ))}
        {!agentsLoading && agents.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">No agents yet</p>
            <p className="text-xs text-muted-foreground">
              Create one or browse the catalog to get started.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 space-y-1.5">
        <Button variant="outline" size="sm" className="w-full" onClick={onNewAgent}>
          + New Agent
        </Button>
        <Button variant="outline" size="sm" className="w-full" onClick={onBrowseCatalog}>
          Browse Catalog
        </Button>
      </div>
    </>
  );
}
