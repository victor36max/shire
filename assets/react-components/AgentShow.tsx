import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button, buttonVariants } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import AppLayout from "./components/AppLayout";
import { navigate } from "./lib/navigate";
import AgentForm from "./AgentForm";
import { ChevronLeft, MoreHorizontal, Pencil } from "lucide-react";
import { type Agent, statusVariant, harnessLabel } from "./types";

const isRunning = (status: string) => status === "active" || status === "starting" || status === "bootstrapping";

export default function AgentShow({
  project,
  agent,
  pushEvent,
}: {
  project: { id: string; name: string };
  agent: Agent;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [restartOpen, setRestartOpen] = React.useState(false);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={() => navigate(`/projects/${project.name}/agents/${agent.name}`)}
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
              <Button onClick={() => pushEvent("start-agent", {})}>Start Agent</Button>
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
                {agent.system_prompt || "Not set"}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      <AgentForm
        open={editOpen}
        title="Edit Agent"
        agent={agent}
        pushEvent={pushEvent}
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
            <AlertDialogAction onClick={() => pushEvent("restart-agent", {})}>Restart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the agent and permanently remove its workspace directory. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => pushEvent("delete-agent", {})}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
