import * as React from "react";
import AgentCard from "./AgentCard";
import AgentForm from "./AgentForm";
import AppLayout from "./components/AppLayout";
import { Button } from "./components/ui/button";
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

import { type Agent, type HarnessType } from "./types";

interface AgentPageProps {
  agents: Agent[];
  editAgent: { id?: number; name?: string; model?: string; system_prompt?: string; harness?: HarnessType } | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function AgentPage({ agents, editAgent, pushEvent }: AgentPageProps) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("New Agent");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [currentAgent, setCurrentAgent] = React.useState<AgentPageProps["editAgent"]>(null);
  const [deleteAgent, setDeleteAgent] = React.useState<Agent | null>(null);

  // Sync edit state from server (e.g. when navigating to /agents/:id/edit)
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

  const handleEdit = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    setCurrentAgent({
      name: agent.name,
      model: agent.model ?? "",
      system_prompt: agent.system_prompt ?? "",
      harness: agent.harness,
    });
    setEditingId(agent.id);
    setFormTitle("Edit Agent");
    setFormOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation();
    setDeleteAgent(agent);
  };

  const handleDeleteConfirm = () => {
    if (deleteAgent) {
      pushEvent("delete-agent", { id: deleteAgent.id });
      setDeleteAgent(null);
    }
  };

  const handleClick = (agent: Agent) => {
    window.location.assign(`/agents/${agent.id}`);
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
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Agents</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.location.assign("/secrets")}>
              Manage Secrets
            </Button>
            <Button onClick={handleNew}>New Agent</Button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No agents yet</p>
            <p className="text-sm mt-1">Create your first agent to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <div key={agent.id} className="relative group">
                <AgentCard agent={agent} onClick={() => handleClick(agent)} />
                <div className="absolute top-2 right-12 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <Button variant="ghost" size="sm" onClick={(e) => handleEdit(e, agent)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => handleDeleteClick(e, agent)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <AgentForm
          open={formOpen}
          title={formTitle}
          agent={currentAgent}
          pushEvent={handleFormSave}
          onClose={handleFormClose}
        />

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
    </AppLayout>
  );
}
