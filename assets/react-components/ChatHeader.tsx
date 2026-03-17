import { Badge } from "./components/ui/badge";
import { type Agent, statusVariant } from "./types";

interface ChatHeaderProps {
  agent: Agent;
}

export default function ChatHeader({ agent }: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      <h2 className="text-lg font-semibold">{agent.name}</h2>
      <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
    </div>
  );
}
