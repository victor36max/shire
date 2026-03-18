import * as React from "react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
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
} from "./components/ui/alert-dialog";
import { ChevronLeft, Play, Trash2, Plus } from "lucide-react";
import AppLayout from "./components/AppLayout";
import ActivityLog from "./ActivityLog";
import Terminal from "./Terminal";
import type { InterAgentMessage } from "./types";

interface SettingsPageProps {
  env_content: string;
  scripts: string[];
  messages: InterAgentMessage[];
  has_more_messages: boolean;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
}

export default function SettingsPage({
  env_content,
  scripts,
  messages,
  has_more_messages,
  pushEvent,
}: SettingsPageProps) {
  const [envDraft, setEnvDraft] = React.useState(env_content);
  const [envDirty, setEnvDirty] = React.useState(false);
  const [newScriptName, setNewScriptName] = React.useState("");
  const [editingScript, setEditingScript] = React.useState<{ name: string; content: string } | null>(null);

  React.useEffect(() => {
    setEnvDraft(env_content);
    setEnvDirty(false);
  }, [env_content]);

  // Listen for script content pushed from server
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.name && typeof detail.content === "string") {
        setEditingScript({ name: detail.name, content: detail.content });
      }
    };
    window.addEventListener("phx:script-content", handler);
    return () => window.removeEventListener("phx:script-content", handler);
  }, []);

  const handleSaveEnv = () => {
    pushEvent("save-env", { content: envDraft });
    setEnvDirty(false);
  };

  const handleCreateScript = () => {
    const name = newScriptName.trim();
    if (!name) return;
    const filename = name.endsWith(".sh") ? name : `${name}.sh`;
    pushEvent("save-script", { name: filename, content: "#!/bin/bash\nset -euo pipefail\n\n" });
    setNewScriptName("");
  };

  const handleSaveScript = () => {
    if (!editingScript) return;
    pushEvent("save-script", { name: editingScript.name, content: editingScript.content });
    setEditingScript(null);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => window.location.assign("/")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Tabs defaultValue="environment">
          <TabsList>
            <TabsTrigger value="environment">Environment</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>

          <TabsContent value="environment" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Global Environment Variables (.env)</Label>
              <Textarea
                value={envDraft}
                onChange={(e) => {
                  setEnvDraft(e.target.value);
                  setEnvDirty(true);
                }}
                placeholder="KEY=value&#10;ANOTHER_KEY=another_value"
                rows={12}
                className="font-mono text-sm"
              />
              <div className="flex justify-end">
                <Button onClick={handleSaveEnv} disabled={!envDirty}>
                  Save Environment
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="scripts" className="space-y-4 pt-4">
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

            {scripts.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No global scripts. Create scripts to run setup commands on the VM.
              </p>
            )}

            <div className="space-y-2">
              {scripts.map((name) => (
                <div key={name} className="flex items-center justify-between border rounded-lg p-3">
                  <button
                    className="font-mono text-sm hover:underline text-left"
                    onClick={() => pushEvent("read-script", { name })}
                  >
                    {name}
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => pushEvent("run-script", { name })}
                      title="Run script"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" title="Delete script">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Script</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{name}&quot;? This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => pushEvent("delete-script", { name })}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>

            {editingScript && (
              <div className="space-y-2 border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <Label className="font-mono">{editingScript.name}</Label>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingScript(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveScript}>
                      Save
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={editingScript.content}
                  onChange={(e) => setEditingScript({ ...editingScript, content: e.target.value })}
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="terminal" className="pt-4">
            <Terminal pushEvent={pushEvent} />
          </TabsContent>

          <TabsContent value="activity" className="pt-4">
            <ActivityLog messages={messages} hasMore={has_more_messages} pushEvent={pushEvent} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
