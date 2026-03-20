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
import { FileText, Settings, FolderOpen } from "lucide-react";
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
    case "crashed":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

interface AgentSidebarProps {
  project: { id: string; name: string };
  projects: Project[];
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent: () => void;
  onDeleteAgent: (agent: Agent) => void;
}

export default function AgentSidebar({
  project,
  projects,
  agents,
  selectedAgentId,
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
        <ProjectSwitcher projects={projects} currentProjectName={project.name} />
      </div>

      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agents</h2>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-md cursor-pointer text-sm ${
              selectedAgentId === agent.id ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
            }`}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor(agent.status)}${agent.status === "active" && agent.busy ? " animate-pulse" : ""}`}
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
                <DropdownMenuItem onClick={() => navigate(`/projects/${project.name}/agents/${agent.name}`)}>
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
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${project.name}/details`)}
        >
          <FileText className="h-4 w-4" />
          Project Details
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${project.name}/settings`)}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => navigate(`/projects/${project.name}/shared`)}
        >
          <FolderOpen className="h-4 w-4" />
          Shared Drive
        </Button>
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
