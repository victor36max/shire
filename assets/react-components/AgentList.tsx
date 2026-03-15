import * as React from "react";
import AgentCard from "./AgentCard";
import { Button } from "./components/ui/button";

interface Agent {
  id: number;
  name: string;
  status: string;
  model: string | null;
  system_prompt: string | null;
}

interface AgentListProps {
  agents: Agent[];
  onEvent?: (event: string, payload: Record<string, unknown>) => void;
}

export default function AgentList({ agents, onEvent }: AgentListProps) {
  const handleClick = (agent: Agent) => {
    // Navigate to agent detail page
    window.location.href = `/agents/${agent.id}`;
  };

  const handleDelete = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    if (window.confirm(`Delete agent "${agent.name}"?`)) {
      onEvent?.("delete-agent", { id: agent.id });
    }
  };

  const handleEdit = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    onEvent?.("edit-agent", { id: agent.id });
  };

  return (
    <div>
      {agents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">No agents yet</p>
          <p className="text-sm mt-1">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="relative group">
              <AgentCard agent={agent} onClick={() => handleClick(agent)} />
              <div className="absolute top-2 right-12 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleEdit(e, agent)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={(e) => handleDelete(e, agent)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
