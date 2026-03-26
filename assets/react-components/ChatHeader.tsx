import { Menu, EllipsisVertical, Eraser } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { type AgentOverview, statusVariant } from "./types";

interface ChatHeaderProps {
  agent: AgentOverview;
  onMenuToggle?: () => void;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function ChatHeader({ agent, onMenuToggle, pushEvent }: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      {onMenuToggle && (
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={onMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <h2 className="text-lg font-semibold">{agent.name}</h2>
      <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Agent options">
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => pushEvent("clear-session", {})}>
              <Eraser className="h-4 w-4 mr-2" />
              Clear Session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
