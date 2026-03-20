import * as React from "react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChevronLeft } from "lucide-react";
import AppLayout from "./components/AppLayout";
import { navigate } from "./lib/navigate";

interface ProjectDetailsPageProps {
  project: { id: string; name: string };
  project_doc: string;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function ProjectDetailsPage({ project, project_doc, pushEvent }: ProjectDetailsPageProps) {
  const [nameValue, setNameValue] = React.useState(project.name);
  const [docValue, setDocValue] = React.useState(project_doc);

  const slugRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const isValidSlug = nameValue.length >= 1 && nameValue.length <= 63 && slugRegex.test(nameValue);
  const nameDirty = nameValue !== project.name;
  const docDirty = docValue !== project_doc;

  React.useEffect(() => {
    setNameValue(project.name);
  }, [project.name]);

  React.useEffect(() => {
    setDocValue(project_doc);
  }, [project_doc]);

  const handleRename = () => {
    pushEvent("rename-project", { name: nameValue });
  };

  const handleSaveDoc = () => {
    pushEvent("save-project-doc", { content: docValue });
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={() => navigate(`/projects/${project.name}`)}
        >
          <ChevronLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <div>
          <h1 className="text-2xl font-bold">Project Details</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage project name and documentation.</p>
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
            />
            <Button onClick={handleRename} disabled={!nameDirty || !isValidSlug}>
              Rename
            </Button>
          </div>
          {nameDirty && !isValidSlug && nameValue.length > 0 && (
            <p className="text-xs text-destructive">
              Invalid name. Use lowercase letters, numbers, and hyphens (1-63 chars).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only. Renaming will change the project URL.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-doc">PROJECT.md</Label>
          <p className="text-xs text-muted-foreground">
            Shared project context visible to all agents. Agents check this before starting and after completing tasks.
          </p>
          <Textarea
            id="project-doc"
            value={docValue}
            onChange={(e) => setDocValue(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
            placeholder="# Project&#10;&#10;Describe your project here..."
          />
          <div className="flex justify-end">
            <Button onClick={handleSaveDoc} disabled={!docDirty}>
              Save Document
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
