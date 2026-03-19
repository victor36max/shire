import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button, buttonVariants } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/ui/alert-dialog";
import AppLayout from "./components/AppLayout";
import { navigate } from "./lib/navigate";
import AgentForm from "./AgentForm";
import { ChevronLeft, Pencil } from "lucide-react";
import { type Agent, statusVariant, harnessLabel } from "./types";

export default function AgentShow({
  project,
  agent,
  pushEvent,
}: {
  project: string;
  agent: Agent;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}) {
  const [editOpen, setEditOpen] = React.useState(false);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Back" onClick={() => navigate(`/projects/${project}`)}>
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
            {(agent.status === "active" || agent.status === "starting" || agent.status === "bootstrapping") && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">Restart Agent</Button>
                </AlertDialogTrigger>
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
            )}
            {agent.status !== "active" && agent.status !== "starting" && agent.status !== "bootstrapping" && (
              <Button onClick={() => pushEvent("start-agent", {})}>Start Agent</Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete Agent</Button>
              </AlertDialogTrigger>
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
          </div>
        </div>

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
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">System Prompt</dt>
                <dd className="text-sm col-span-2">
                  <pre className="whitespace-pre-wrap font-sans">{agent.system_prompt || "Not set"}</pre>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <AgentForm
        open={editOpen}
        title="Edit Agent"
        agent={agent}
        pushEvent={pushEvent}
        onClose={() => setEditOpen(false)}
      />
    </AppLayout>
  );
}
