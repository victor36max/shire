import * as React from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ChevronLeft } from "lucide-react";
import { Spinner, PageLoader } from "./ui/spinner";
import AppLayout from "./AppLayout";
import { useNavigate } from "react-router-dom";
import { useProjectId, useProjectDoc, useRenameProject, useSaveProjectDoc } from "../hooks";

export default function ProjectDetailsPage() {
  const navigate = useNavigate();
  const { projectId, projectName } = useProjectId();
  const { data: projectDoc, isLoading: docLoading } = useProjectDoc(projectId);
  const renameProject = useRenameProject(projectId ?? "");
  const saveDoc = useSaveProjectDoc(projectId ?? "");

  const project_doc = projectDoc?.content ?? "";
  const isRenaming = renameProject.isPending;
  const isSavingDoc = saveDoc.isPending;

  const [nameValue, setNameValue] = React.useState(projectName);
  const [docValue, setDocValue] = React.useState(project_doc);

  const slugRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const isValidSlug = nameValue.length >= 1 && nameValue.length <= 63 && slugRegex.test(nameValue);
  const nameDirty = nameValue !== projectName;
  const docDirty = docValue !== project_doc;

  React.useEffect(() => {
    setNameValue(projectName);
  }, [projectName]);

  React.useEffect(() => {
    setDocValue(project_doc);
  }, [project_doc]);

  const handleRename = () => {
    renameProject.mutate(nameValue);
  };

  const handleSaveDoc = () => {
    saveDoc.mutate(docValue);
  };

  if (!projectId) {
    return <PageLoader />;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => navigate(`/projects/${projectName}`)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Project Details</h1>
            <p className="text-sm text-muted-foreground">Manage project name and documentation.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-name">Project Name</Label>
          <div className="flex gap-2">
            <Input
              id="project-name"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder="project-name"
              className="max-w-sm"
              aria-describedby={
                nameDirty && !isValidSlug && nameValue.length > 0 ? "project-name-error" : undefined
              }
              aria-invalid={nameDirty && !isValidSlug && nameValue.length > 0}
            />
            <Button onClick={handleRename} disabled={!nameDirty || !isValidSlug || isRenaming}>
              {isRenaming ? "Renaming..." : "Rename"}
            </Button>
          </div>
          {nameDirty && !isValidSlug && nameValue.length > 0 && (
            <p id="project-name-error" className="text-xs text-destructive">
              Invalid name. Use lowercase letters, numbers, and hyphens (1-63 chars).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only. Renaming will change the project URL.
          </p>
        </div>

        {docLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" className="text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="project-doc">PROJECT.md</Label>
            <p className="text-xs text-muted-foreground">
              Shared project context visible to all agents. Agents check this before starting and
              after completing tasks.
            </p>
            <Textarea
              id="project-doc"
              value={docValue}
              onChange={(e) => setDocValue(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
              placeholder="# Project&#10;&#10;Describe your project here..."
            />
            <div className="flex justify-end">
              <Button onClick={handleSaveDoc} disabled={!docDirty || isSavingDoc}>
                {isSavingDoc ? "Saving..." : "Save Document"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
