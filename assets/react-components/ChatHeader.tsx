import { Menu } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { type Agent, statusVariant } from "./types";

interface ChatHeaderProps {
  agent: Agent;
  onMenuToggle?: () => void;
}

export default function ChatHeader({ agent, onMenuToggle }: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      {onMenuToggle && (
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={onMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <h2 className="text-lg font-semibold">{agent.name}</h2>
      <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
    </div>
  );
}
