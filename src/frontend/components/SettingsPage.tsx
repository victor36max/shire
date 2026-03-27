import * as React from "react";
import { Button, buttonVariants } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import { ChevronLeft, Play, Trash2, Plus, X, Loader2 } from "lucide-react";
import AppLayout from "./AppLayout";
import ThemeSelector from "./ThemeSelector";
import { navigate } from "./lib/navigate";
import ActivityLog from "./ActivityLog";
import {
  useProjectId,
  useEnv,
  useScripts,
  useActivity,
  useSaveEnv,
  useSaveScript,
  useDeleteScript,
  useRunScript,
} from "../lib/hooks";
import { useSubscription } from "../lib/ws";
import { useQueryClient } from "@tanstack/react-query";

interface Script {
  name: string;
  content: string;
}

interface ScriptDraft {
  name: string;
  content: string;
  dirty: boolean;
  originalName: string;
}

interface EnvRow {
  key: string;
  value: string;
}

function parseEnv(content: string): EnvRow[] {
  if (!content.trim()) return [];
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => {
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) return { key: line.trim(), value: "" };
      return { key: line.slice(0, eqIndex).trim(), value: line.slice(eqIndex + 1).trim() };
    });
}

function serializeEnv(rows: EnvRow[]): string {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key}=${r.value}`)
    .join("\n");
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { projectId, projectName } = useProjectId();

  const { data: envData, isLoading: envLoading } = useEnv(projectId);
  const { data: scripts = [], isLoading: scriptsLoading } = useScripts(projectId);
  const { data: activityData } = useActivity(projectId);
  const saveEnv = useSaveEnv(projectId ?? "");
  const saveScript = useSaveScript(projectId ?? "");
  const deleteScript = useDeleteScript(projectId ?? "");
  const runScript = useRunScript(projectId ?? "");

  useSubscription(projectId ? `project:${projectId}:schedules` : null, () => {
    queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
  });

  const env_content = envData?.content ?? "";
  const messages = (activityData?.messages ?? []) as never[];
  const has_more_messages = activityData?.hasMore ?? false;

  const [envRows, setEnvRows] = React.useState<EnvRow[]>(() => parseEnv(env_content));
  const [envDirty, setEnvDirty] = React.useState(false);
  const [newScriptName, setNewScriptName] = React.useState("");
  const [scriptDrafts, setScriptDrafts] = React.useState<ScriptDraft[]>([]);

  React.useEffect(() => {
    setEnvRows(parseEnv(env_content));
    setEnvDirty(false);
  }, [env_content]);

  React.useEffect(() => {
    setScriptDrafts(
      (scripts as Script[]).map((s) => ({
        name: s.name,
        content: s.content,
        dirty: false,
        originalName: s.name,
      })),
    );
  }, [scripts]);

  const handleSaveEnv = () => {
    saveEnv.mutate(serializeEnv(envRows));
    setEnvDirty(false);
  };

  const updateEnvRow = (index: number, field: "key" | "value", val: string) => {
    setEnvRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
    setEnvDirty(true);
  };

  const addEnvRow = () => {
    setEnvRows((prev) => [...prev, { key: "", value: "" }]);
    setEnvDirty(true);
  };

  const removeEnvRow = (index: number) => {
    setEnvRows((prev) => prev.filter((_, i) => i !== index));
    setEnvDirty(true);
  };

  const handleCreateScript = () => {
    const name = newScriptName.trim();
    if (!name) return;
    const filename = name.endsWith(".sh") ? name : `${name}.sh`;
    saveScript.mutate({ name: filename, content: "#!/bin/bash\nset -euo pipefail\n\n" });
    setNewScriptName("");
  };

  const updateScriptDraft = (index: number, field: "name" | "content", value: string) => {
    setScriptDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value, dirty: true } : d)),
    );
  };

  const handleSaveScriptAt = (index: number) => {
    const draft = scriptDrafts[index];
    if (!draft) return;
    if (draft.name !== draft.originalName) {
      saveScript.mutate({ name: draft.name, content: draft.content });
      deleteScript.mutate(draft.originalName);
    } else {
      saveScript.mutate({ name: draft.name, content: draft.content });
    }
  };

  const handleLoadMoreMessages = () => {
    queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
  };

  if (!projectId) return <div className="p-8">Loading...</div>;

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
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Tabs defaultValue="environment">
          <TabsList>
            <TabsTrigger value="environment">Environment</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="environment" className="space-y-4 pt-4">
            {envLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                <Label>Global Environment Variables</Label>
                {envRows.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">
                    No environment variables. Add variables to configure your agents.
                  </p>
                )}
                {envRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) => updateEnvRow(index, "key", e.target.value)}
                      placeholder="KEY"
                      className="font-mono text-sm w-1/3"
                      aria-label={`Variable ${index + 1} key`}
                    />
                    <span className="text-muted-foreground">=</span>
                    <Input
                      value={row.value}
                      onChange={(e) => updateEnvRow(index, "value", e.target.value)}
                      placeholder="value"
                      className="font-mono text-sm flex-1 min-w-0"
                      aria-label={`Variable ${index + 1} value`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeEnvRow(index)}
                      aria-label={`Remove variable ${index + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={addEnvRow}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Variable
                  </Button>
                  <Button onClick={handleSaveEnv} disabled={!envDirty || saveEnv.isPending}>
                    {saveEnv.isPending ? "Saving..." : "Save Environment"}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="scripts" className="space-y-4 pt-4">
            {scriptsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    value={newScriptName}
                    onChange={(e) => setNewScriptName(e.target.value)}
                    placeholder="script-name.sh"
                    className="max-w-xs"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateScript()}
                  />
                  <Button variant="outline" size="sm" onClick={handleCreateScript}>
                    <Plus className="h-4 w-4 mr-1" />
                    New Script
                  </Button>
                </div>

                {scriptDrafts.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4">
                    No global scripts. Create scripts to run setup commands on the VM.
                  </p>
                )}

                <div className="space-y-4">
                  {scriptDrafts.map((draft, index) => (
                    <div key={draft.originalName} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Label className="shrink-0">Name</Label>
                        <Input
                          value={draft.name}
                          onChange={(e) => updateScriptDraft(index, "name", e.target.value)}
                          className="font-mono text-sm"
                          aria-label={`Script ${index + 1} name`}
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => handleSaveScriptAt(index)}
                            disabled={!draft.dirty || saveScript.isPending}
                          >
                            {saveScript.isPending ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => runScript.mutate(draft.originalName)}
                            aria-label="Run script"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label="Delete script">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Script</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete &quot;{draft.originalName}&quot;?
                                  This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className={buttonVariants({ variant: "destructive" })}
                                  onClick={() => deleteScript.mutate(draft.originalName)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      <Textarea
                        value={draft.content}
                        onChange={(e) => updateScriptDraft(index, "content", e.target.value)}
                        rows={8}
                        className="font-mono text-sm"
                        aria-label={`Script ${index + 1} content`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="activity" className="pt-4">
            <ActivityLog
              messages={messages}
              hasMore={has_more_messages}
              onLoadMore={handleLoadMoreMessages}
            />
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 pt-4">
            <ThemeSelector />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
