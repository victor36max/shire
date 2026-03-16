import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { type Agent, statusVariant, harnessLabel } from "./types";

export default function AgentCard({ agent, onClick }: { agent: Agent; onClick?: () => void }) {
  const scriptCount = agent.scripts?.length || 0;

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{harnessLabel(agent.harness)}</span>
          {agent.model && <span>· {agent.model}</span>}
          {scriptCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {scriptCount} {scriptCount === 1 ? "script" : "scripts"}
            </Badge>
          )}
        </div>
        {agent.description && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{agent.description}</p>}
      </CardContent>
    </Card>
  );
}
