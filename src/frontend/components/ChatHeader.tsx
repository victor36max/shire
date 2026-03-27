import { Menu, EllipsisVertical, Eraser } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { type AgentOverview, statusVariant } from "./types";
import { useProjectId, useClearSession } from "../lib/hooks";

interface ChatHeaderProps {
  agent: AgentOverview;
  onMenuToggle?: () => void;
}

export default function ChatHeader({ agent, onMenuToggle }: ChatHeaderProps) {
  const { projectId } = useProjectId();
  const clearSession = useClearSession(projectId ?? "");

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      {onMenuToggle && (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
          onClick={onMenuToggle}
        >
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
            <DropdownMenuItem onClick={() => clearSession.mutate(agent.id)}>
              <Eraser className="h-4 w-4 mr-2" />
              Clear Session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
