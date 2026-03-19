import * as React from "react";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import ProjectSwitcher from "./ProjectSwitcher";
import { navigate } from "./lib/navigate";
import { type Agent, type AgentStatus, type Project } from "./types";

function statusDotColor(status: AgentStatus): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "starting":
    case "bootstrapping":
      return "bg-yellow-500";
    case "failed":
    case "crashed":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

interface AgentSidebarProps {
  project: string;
  projects: Project[];
  agents: Agent[];
  selectedAgentName: string | null;
  onSelectAgent: (name: string) => void;
  onNewAgent: () => void;
  onDeleteAgent: (agent: Agent) => void;
}

export default function AgentSidebar({
  project,
  projects,
  agents,
  selectedAgentName,
  onSelectAgent,
  onNewAgent,
  onDeleteAgent,
}: AgentSidebarProps) {
  const [deleteAgent, setDeleteAgent] = React.useState<Agent | null>(null);

  const handleDeleteConfirm = () => {
    if (deleteAgent) {
      onDeleteAgent(deleteAgent);
      setDeleteAgent(null);
    }
  };

  return (
    <div className="w-64 border-r border-border bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <ProjectSwitcher projects={projects} currentProject={project} />
      </div>

      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agents</h2>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-md cursor-pointer text-sm ${
              selectedAgentName === agent.name ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
            }`}
            onClick={() => onSelectAgent(agent.name)}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotColor(agent.status)}${agent.status === "active" && agent.busy ? " animate-pulse" : ""}`}
            />
            <span className="truncate flex-1">{agent.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="3" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="13" r="1.5" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(`/projects/${project}/agents/${agent.name}`)}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteAgent(agent)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {agents.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No agents yet</p>}
      </div>

      <div className="p-3 border-t border-border space-y-1">
        <Button variant="outline" size="sm" className="w-full" onClick={onNewAgent}>
          + New Agent
        </Button>
        <button
          type="button"
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded hover:bg-muted"
          onClick={() => navigate(`/projects/${project}/settings`)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Settings
        </button>
        <button
          type="button"
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded hover:bg-muted"
          onClick={() => navigate(`/projects/${project}/shared`)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Shared Drive
        </button>
      </div>

      <AlertDialog
        open={!!deleteAgent}
        onOpenChange={(open) => {
          if (!open) setDeleteAgent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteAgent?.name}&rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
