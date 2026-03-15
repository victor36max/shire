import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "./components/ui/card";
import { Badge } from "./components/ui/badge";

interface Agent {
  id: number;
  name: string;
  status: string;
  model: string | null;
  system_prompt: string | null;
}

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
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

export default function AgentCard({ agent, onClick }: AgentCardProps) {
  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {agent.model || "No model set"}
        </p>
        {agent.system_prompt && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {agent.system_prompt}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
