import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { buttonVariants } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { type AgentOverview, type AgentStatus } from "../types";
import { useProjectId, useAgents, useDeleteAgent } from "../../hooks";

function statusDotColor(status: AgentStatus): string {
  switch (status) {
    case "active":
      return "bg-status-active";
    case "starting":
    case "bootstrapping":
      return "bg-status-starting";
    case "crashed":
      return "bg-status-error";
    default:
      return "bg-status-idle";
  }
}

interface AgentListPanelProps {
  onNewAgent: () => void;
  onBrowseCatalog: () => void;
}

export default function AgentListPanel({ onNewAgent, onBrowseCatalog }: AgentListPanelProps) {
  const navigate = useNavigate();
  const { agentName } = useParams<{ agentName: string }>();
  const { projectId, projectName } = useProjectId();
  const { data: agents = [], isLoading: agentsLoading } = useAgents(projectId);
  const deleteAgentMut = useDeleteAgent(projectId ?? "");

  const selectedAgentId = agentName ? (agents.find((a) => a.name === agentName)?.id ?? null) : null;
  const [deleteAgent, setDeleteAgent] = React.useState<AgentOverview | null>(null);

  const handleDeleteConfirm = () => {
    if (deleteAgent) {
      deleteAgentMut.mutate(deleteAgent.id);
      setDeleteAgent(null);
    }
  };

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
          <div key={agent.id} className="group flex items-center mx-1">
            <button
              type="button"
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm flex-1 min-w-0 text-left ${
                selectedAgentId === agent.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted text-foreground"
              }`}
              onClick={() => handleSelectAgent(agent.id)}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor(agent.status)}${agent.status === "active" && agent.busy ? " animate-pulse" : ""}`}
                role="img"
                aria-label={`Status: ${agent.status}${agent.busy ? " (busy)" : ""}`}
              />
              <span className="truncate">{agent.name}</span>
              {agent.unreadCount ? (
                <span className="ml-auto shrink-0 min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center px-1">
                  {agent.unreadCount > 99 ? "99+" : agent.unreadCount}
                </span>
              ) : null}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded hover:bg-background text-muted-foreground"
                  aria-label={`${agent.name} actions`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="3" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="13" r="1.5" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/projects/${projectName}/agents/${agent.name}/settings`)}
                >
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
              Are you sure you want to delete &ldquo;{deleteAgent?.name}&rdquo;? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleDeleteConfirm}
              disabled={deleteAgentMut.isPending}
            >
              {deleteAgentMut.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
