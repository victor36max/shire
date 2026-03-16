import * as React from "react";
import { stringify, parse } from "yaml";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import type { Agent, BaseRecipe, HarnessType, Script } from "./types";

interface AgentFormProps {
  open: boolean;
  title: string;
  agent: Agent | null;
  baseRecipes?: BaseRecipe[];
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

function buildRecipeYaml(fields: {
  name: string;
  description: string;
  extends: string;
  harness: string;
  model: string;
  systemPrompt: string;
  scripts: Script[];
}): string {
  const doc: Record<string, unknown> = { version: 1, name: fields.name };
  if (fields.description) doc.description = fields.description;
  if (fields.extends) doc.extends = fields.extends;
  if (fields.harness) doc.harness = fields.harness;
  if (fields.model) doc.model = fields.model;
  if (fields.systemPrompt) doc.system_prompt = fields.systemPrompt;
  if (fields.scripts.length > 0) doc.scripts = fields.scripts;
  return stringify(doc, { lineWidth: 0 });
}

function parseRecipeYaml(yaml: string) {
  try {
    const doc = parse(yaml) as Record<string, unknown>;
    return {
      name: (doc.name as string) || "",
      description: (doc.description as string) || "",
      extends: (doc.extends as string) || "",
      harness: (doc.harness as string) || "pi",
      model: (doc.model as string) || "",
      systemPrompt: (doc.system_prompt as string) || "",
      scripts: (doc.scripts as Script[]) || [],
    };
  } catch {
    return null;
  }
}

export default function AgentForm({
  open,
  title,
  agent,
  baseRecipes = [],
  pushEvent,
  onClose,
}: AgentFormProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [extendsRecipe, setExtendsRecipe] = React.useState("");
  const [model, setModel] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [harness, setHarness] = React.useState<HarnessType>("pi");
  const [scripts, setScripts] = React.useState<Script[]>([]);
  const [rawMode, setRawMode] = React.useState(false);
  const [rawYaml, setRawYaml] = React.useState("");

  React.useEffect(() => {
    if (agent?.recipe) {
      const parsed = parseRecipeYaml(agent.recipe);
      if (parsed) {
        setName(parsed.name);
        setDescription(parsed.description);
        setExtendsRecipe(parsed.extends);
        setModel(parsed.model);
        setSystemPrompt(parsed.systemPrompt);
        setHarness((parsed.harness as HarnessType) || "pi");
        setScripts(parsed.scripts);
        setRawYaml(agent.recipe);
      }
    } else {
      setName(agent?.name || "");
      setDescription(agent?.description || "");
      setExtendsRecipe("");
      setModel(agent?.model || "");
      setSystemPrompt(agent?.system_prompt || "");
      setHarness(agent?.harness || "pi");
      setScripts(agent?.scripts || []);
      setRawYaml("");
    }
    setRawMode(false);
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const recipe = rawMode
      ? rawYaml
      : buildRecipeYaml({ name, description, extends: extendsRecipe, harness, model, systemPrompt, scripts });

    const event = agent?.id ? "update-agent" : "create-agent";
    const payload: Record<string, unknown> = { recipe };
    if (agent?.id) payload.id = agent.id;

    pushEvent(event, payload);
    onClose();
  };

  const handleToggleRaw = () => {
    if (rawMode) {
      // Switching to structured: parse raw YAML
      const parsed = parseRecipeYaml(rawYaml);
      if (parsed) {
        setName(parsed.name);
        setDescription(parsed.description);
        setExtendsRecipe(parsed.extends);
        setModel(parsed.model);
        setSystemPrompt(parsed.systemPrompt);
        setHarness((parsed.harness as HarnessType) || "pi");
        setScripts(parsed.scripts);
      }
    } else {
      // Switching to raw: serialize current fields
      setRawYaml(
        buildRecipeYaml({ name, description, extends: extendsRecipe, harness, model, systemPrompt, scripts })
      );
    }
    setRawMode(!rawMode);
  };

  const addScript = () => setScripts([...scripts, { name: "", run: "" }]);
  const removeScript = (idx: number) => setScripts(scripts.filter((_, i) => i !== idx));
  const updateScript = (idx: number, field: keyof Script, value: string) => {
    const updated = [...scripts];
    updated[idx] = { ...updated[idx], [field]: value };
    setScripts(updated);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {title === "New Agent" ? "Create a new agent to get started." : "Update the agent details."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={handleToggleRaw}>
            {rawMode ? "Structured Editor" : "Raw YAML"}
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {rawMode ? (
            <div className="space-y-2">
              <Label htmlFor="raw-yaml">Recipe YAML</Label>
              <Textarea
                id="raw-yaml"
                value={rawYaml}
                onChange={(e) => setRawYaml(e.target.value)}
                placeholder="version: 1&#10;name: my-agent&#10;harness: pi&#10;..."
                rows={20}
                className="font-mono text-sm"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do?"
                />
              </div>
              {baseRecipes.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="extends">Extends</Label>
                  <Select value={extendsRecipe} onValueChange={setExtendsRecipe}>
                    <SelectTrigger>
                      <SelectValue placeholder="None (no base recipe)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {baseRecipes.map((r) => (
                        <SelectItem key={r.id} value={r.name}>
                          {r.name}
                          {r.description && ` — ${r.description}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="harness">Harness</Label>
                <Select value={harness} onValueChange={(v) => setHarness(v as HarnessType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pi">Pi</SelectItem>
                    <SelectItem value="claude_code">Claude Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. claude-sonnet-4-6"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <Textarea
                  id="system_prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Instructions for the agent..."
                  rows={4}
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Scripts</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addScript}>
                    Add Script
                  </Button>
                </div>
                {scripts.map((script, idx) => (
                  <div key={idx} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={script.name}
                        onChange={(e) => updateScript(idx, "name", e.target.value)}
                        placeholder="Script name (e.g. install-python)"
                        className="flex-1"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeScript(idx)}>
                        Remove
                      </Button>
                    </div>
                    <Textarea
                      value={script.run}
                      onChange={(e) => updateScript(idx, "run", e.target.value)}
                      placeholder="apt-get install -y python3"
                      rows={2}
                      className="font-mono text-sm"
                    />
                  </div>
                ))}
                {scripts.length === 0 && (
                  <p className="text-sm text-muted-foreground">No setup scripts. Add scripts to install dependencies when the agent starts.</p>
                )}
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Agent</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
