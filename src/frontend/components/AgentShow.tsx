import * as React from "react";
import { useParams } from "react-router-dom";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import AppLayout from "./AppLayout";
import { navigate } from "./lib/navigate";
import AgentForm from "./AgentForm";
import { ChevronLeft, MoreHorizontal, Pencil } from "lucide-react";
import { type Agent, statusVariant, harnessLabel } from "./types";
import {
  useProjectId,
  useAgents,
  useAgentDetail,
  useRestartAgent,
  useDeleteAgent,
  useUpdateAgent,
} from "../lib/hooks";

const isRunning = (status: string) =>
  status === "active" || status === "starting" || status === "bootstrapping";

export default function AgentShow() {
  const { agentName } = useParams<{ agentName: string }>();
  const { projectId, projectName } = useProjectId();

  const { data: agentList = [] } = useAgents(projectId);
  const selectedAgent = agentList.find((a) => a.name === agentName);
  const agentId = selectedAgent?.id;

  const { data: agentDetail } = useAgentDetail(projectId, agentId);
  const restartAgent = useRestartAgent(projectId ?? "");
  const deleteAgent = useDeleteAgent(projectId ?? "");
  const updateAgent = useUpdateAgent(projectId ?? "");

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [restartOpen, setRestartOpen] = React.useState(false);

  if (!projectId || !agentId || !agentDetail || "error" in agentDetail) {
    return <div className="p-8">Loading...</div>;
  }

  const agent = agentDetail as unknown as Agent;

  const handleFormSave = (_event: string, payload: Record<string, unknown>) => {
    updateAgent.mutate({ id: agent.id, recipeYaml: payload.recipeYaml as string });
    setEditOpen(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={() => navigate(`/projects/${projectName}/agents/${agent.name}`)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            {isRunning(agent.status) ? (
              <Button variant="outline" onClick={() => setRestartOpen(true)}>
                Restart Agent
              </Button>
            ) : (
              <Button onClick={() => restartAgent.mutate(agentId!)}>Start Agent</Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete Agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <dl className="divide-y divide-border">
                <div className="py-3 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-muted-foreground">Name</dt>
                  <dd className="text-sm col-span-2">{agent.name}</dd>
                </div>
                {agent.description && (
                  <div className="py-3 grid grid-cols-3 gap-4">
                    <dt className="text-sm font-medium text-muted-foreground">Description</dt>
                    <dd className="text-sm col-span-2">{agent.description}</dd>
                  </div>
                )}
                <div className="py-3 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-muted-foreground">Model</dt>
                  <dd className="text-sm col-span-2">{agent.model || "Not set"}</dd>
                </div>
                {agent.harness && (
                  <div className="py-3 grid grid-cols-3 gap-4">
                    <dt className="text-sm font-medium text-muted-foreground">Harness</dt>
                    <dd className="text-sm col-span-2">
                      <Badge variant="outline">{harnessLabel(agent.harness)}</Badge>
                    </dd>
                  </div>
                )}
                <div className="py-3 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                  <dd className="text-sm col-span-2">
                    <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">System Prompt</h3>
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {agent.systemPrompt || "Not set"}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      <AgentForm
        open={editOpen}
        title="Edit Agent"
        agent={agent}
        onSave={handleFormSave}
        onClose={() => setEditOpen(false)}
      />

      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Agent</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the current runner and restart the agent. The VM will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => restartAgent.mutate(agentId!)}>
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the agent and permanently remove its workspace directory. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => deleteAgent.mutate(agentId!)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
