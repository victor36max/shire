import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Menu, EllipsisVertical, Eraser, Settings, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { type AgentOverview } from "./types";
import { useProjectId, useClearSession, useDeleteAgent } from "../hooks";

interface ChatHeaderProps {
  agent: AgentOverview;
  onMenuToggle?: () => void;
}

export default function ChatHeader({ agent, onMenuToggle }: ChatHeaderProps) {
  const navigate = useNavigate();
  const { projectName } = useParams<{ projectName: string }>();
  const { projectId } = useProjectId();
  const clearSession = useClearSession(projectId ?? "");
  const deleteAgentMut = useDeleteAgent(projectId ?? "");
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const handleDelete = () => {
    deleteAgentMut.mutate(agent.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        navigate(`/projects/${projectName}`);
      },
    });
  };

  return (
    <>
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
        <span className="text-lg">{agent.emoji || "\u{1F916}"}</span>
        <h2 className="text-lg font-semibold">{agent.name}</h2>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Agent options">
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => navigate(`/projects/${projectName}/agents/${agent.name}/settings`)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => clearSession.mutate(agent.id)}>
                <Eraser className="h-4 w-4 mr-2" />
                Clear Session
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{agent.name}&rdquo;? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleDelete}
              disabled={deleteAgentMut.isPending}
            >
              {deleteAgentMut.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
