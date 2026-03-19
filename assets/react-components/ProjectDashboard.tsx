import * as React from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import AppLayout from "./components/AppLayout";
import { navigate } from "./lib/navigate";
import type { Project } from "./types";

interface ProjectDashboardProps {
  projects: Project[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

function projectStatusVariant(status: string): "default" | "secondary" | "destructive" {
  switch (status) {
    case "running":
      return "default";
    case "starting":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export default function ProjectDashboard({ projects, pushEvent }: ProjectDashboardProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [projectName, setProjectName] = React.useState("");
  const [deleteProject, setDeleteProject] = React.useState<Project | null>(null);

  const nameValid = PROJECT_NAME_REGEX.test(projectName);

  const handleCreate = () => {
    if (!nameValid) return;
    pushEvent("create-project", { name: projectName });
    setProjectName("");
    setCreateOpen(false);
  };

  const handleDelete = () => {
    if (!deleteProject) return;
    pushEvent("delete-project", { name: deleteProject.name });
    setDeleteProject(null);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Projects</h1>
          <Button onClick={() => setCreateOpen(true)}>+ New Project</Button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">No projects yet. Create one to get started.</p>
            <Button onClick={() => setCreateOpen(true)}>Create Project</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Card
                key={project.name}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/projects/${project.name}`)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">{project.name}</h3>
                    <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteProject(project);
                      }}
                    >
                      Delete
                    </Button>
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
                Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.
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

      <AlertDialog open={!!deleteProject} onOpenChange={(open) => !open && setDeleteProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteProject?.name}&rdquo;? This will destroy the VM and all its
              data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
