import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { type Agent, statusVariant, harnessLabel } from "./types";

export default function AgentCard({ agent, onClick }: { agent: Agent; onClick?: () => void }) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {harnessLabel(agent.harness)}
          {agent.model ? ` · ${agent.model}` : ""}
        </p>
        {agent.system_prompt && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{agent.system_prompt}</p>
        )}
      </CardContent>
    </Card>
  );
}
