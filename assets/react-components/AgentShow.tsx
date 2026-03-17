import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button, buttonVariants } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
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
import Terminal from "./Terminal";
import SecretList from "./SecretList";
import AgentForm from "./AgentForm";
import { ChevronLeft, Pencil } from "lucide-react";
import { type Agent, type BaseRecipe, type Secret, statusVariant, harnessLabel } from "./types";

const agentSecretEvents = {
  create: "create-agent-secret",
  update: "update-agent-secret",
  delete: "delete-agent-secret",
};

export default function AgentShow({
  agent,
  secrets,
  baseRecipes = [],
  pushEvent,
}: {
  agent: Agent;
  secrets: Secret[];
  baseRecipes?: BaseRecipe[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const showTerminal = agent.status === "active" || agent.status === "sleeping";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Back" onClick={() => window.location.assign("/")}>
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
                      This will stop the current runner, re-run recipe scripts, and restart the agent. The VM will be
                      preserved.
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
                <Button variant="destructive">Kill Agent</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Kill Agent</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will destroy the agent's VM entirely. The agent will need a full re-bootstrap on next start.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className={buttonVariants({ variant: "destructive" })}
                    onClick={() => pushEvent("kill-agent", {})}
                  >
                    Kill
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
              <div className="py-3 grid grid-cols-3 gap-4">
                <dt className="text-sm font-medium text-muted-foreground">Harness</dt>
                <dd className="text-sm col-span-2">
                  <Badge variant="outline">{harnessLabel(agent.harness)}</Badge>
                </dd>
              </div>
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
              {agent.scripts && agent.scripts.length > 0 && (
                <div className="py-3 grid grid-cols-3 gap-4">
                  <dt className="text-sm font-medium text-muted-foreground">Scripts</dt>
                  <dd className="text-sm col-span-2 space-y-1">
                    {agent.scripts.map((s) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {s.name}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono truncate">{s.run}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Tabs defaultValue={showTerminal ? "terminal" : "environment"}>
          <TabsList>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="environment">Environment</TabsTrigger>
          </TabsList>
          {showTerminal && (
            <TabsContent value="terminal" forceMount className="data-[state=inactive]:hidden">
              <Card>
                <CardContent className="pt-6">
                  <Terminal pushEvent={pushEvent} />
                </CardContent>
              </Card>
            </TabsContent>
          )}
          <TabsContent value="environment">
            <Card>
              <CardContent className="pt-6">
                <SecretList
                  secrets={secrets}
                  pushEvent={pushEvent}
                  events={agentSecretEvents}
                  description="Environment variables specific to this agent. These override global secrets with the same key."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AgentForm
        open={editOpen}
        title="Edit Agent"
        agent={agent}
        baseRecipes={baseRecipes}
        pushEvent={pushEvent}
        onClose={() => setEditOpen(false)}
      />
    </AppLayout>
  );
}
