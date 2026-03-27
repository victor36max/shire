import * as React from "react";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import AppLayout from "./AppLayout";
import { navigate } from "./lib/navigate";
import { MoreHorizontal } from "lucide-react";
import type { Project } from "./types";
import { useProjects, useCreateProject, useDeleteProject, useRestartProject } from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import { useQueryClient } from "@tanstack/react-query";

function projectStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "starting":
    case "stopped":
      return "secondary";
    case "idle":
      return "outline";
    case "unreachable":
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export default function ProjectDashboard() {
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const restartProject = useRestartProject();

  useSubscription("projects:lobby", () => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [projectName, setProjectName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<Project | null>(null);
  const [restartingId, setRestartingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRestartingId(null);
  }, [projects]);

  const nameValid = PROJECT_NAME_REGEX.test(projectName);

  const handleCreate = () => {
    if (!nameValid) return;
    createProject.mutate(projectName);
    setProjectName("");
    setCreateOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteProject.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Projects</h1>
          <Button onClick={() => setCreateOpen(true)}>+ New Project</Button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16 max-w-md mx-auto">
            <h2 className="text-lg font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6">
              Each project gets its own isolated VM with a team of AI agents that can collaborate on
              tasks together.
            </p>
            <Button onClick={() => setCreateOpen(true)}>Create Your First Project</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/projects/${project.name}`)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">{project.name}</h3>
                    <div className="flex items-center gap-2">
                      <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`${project.name} actions`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {project.status !== "running" && (
                            <DropdownMenuItem
                              disabled={restartingId === project.id}
                              onClick={() => {
                                setRestartingId(project.id);
                                restartProject.mutate(project.id);
                              }}
                            >
                              {restartingId === project.id ? "Restarting..." : "Restart"}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(project);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a new project with its own isolated VM.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              placeholder="my-project"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              autoFocus
            />
            {projectName && !nameValid && (
              <p className="text-sm text-destructive">
                Use lowercase letters, numbers, and hyphens only. Must start and end with a letter
                or number.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!nameValid}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This will destroy
              the VM and all its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
