import * as React from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import AppLayout from "./components/AppLayout";

interface Agent {
  id: number;
  name: string;
  status: string;
  model: string | null;
  system_prompt: string | null;
}

interface AgentShowProps {
  agent: Agent;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

const statusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "active":
      return "default";
    case "starting":
      return "secondary";
    case "failed":
      return "destructive";
    case "sleeping":
    case "destroyed":
      return "outline";
    default:
      return "secondary";
  }
};

export default function AgentShow({ agent, pushEvent }: AgentShowProps) {
  return (
    <AppLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Back
          </Button>
          <Button onClick={() => pushEvent("edit", { id: agent.id })}>
            Edit
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <dl className="divide-y divide-border">
            <div className="py-3 grid grid-cols-3 gap-4">
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="text-sm col-span-2">{agent.name}</dd>
            </div>
            <div className="py-3 grid grid-cols-3 gap-4">
              <dt className="text-sm font-medium text-muted-foreground">Model</dt>
              <dd className="text-sm col-span-2">{agent.model || "Not set"}</dd>
            </div>
            <div className="py-3 grid grid-cols-3 gap-4">
              <dt className="text-sm font-medium text-muted-foreground">
                Status
              </dt>
              <dd className="text-sm col-span-2">
                <Badge variant={statusVariant(agent.status)}>
                  {agent.status}
                </Badge>
              </dd>
            </div>
            <div className="py-3 grid grid-cols-3 gap-4">
              <dt className="text-sm font-medium text-muted-foreground">
                System Prompt
              </dt>
              <dd className="text-sm col-span-2">
                <pre className="whitespace-pre-wrap font-sans">
                  {agent.system_prompt || "Not set"}
                </pre>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
    </AppLayout>
  );
}
