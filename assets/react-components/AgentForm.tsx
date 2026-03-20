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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import type { Agent, HarnessType, Skill, SkillReference } from "./types";

interface AgentFormProps {
  open: boolean;
  title: string;
  agent: Agent | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

function buildRecipeYaml(fields: {
  name: string;
  description: string;
  harness: string;
  model: string;
  systemPrompt: string;
  skills: Skill[];
}): string {
  const doc: Record<string, unknown> = { version: 1, name: fields.name };
  if (fields.description) doc.description = fields.description;
  if (fields.harness) doc.harness = fields.harness;
  if (fields.model) doc.model = fields.model;
  if (fields.systemPrompt) doc.system_prompt = fields.systemPrompt;
  if (fields.skills.length > 0) doc.skills = fields.skills;
  return stringify(doc, { lineWidth: 0 });
}

function parseRecipeYaml(yaml: string) {
  try {
    const doc = parse(yaml) as Record<string, unknown>;
    return {
      name: (doc.name as string) || "",
      description: (doc.description as string) || "",
      harness: (doc.harness as string) || "claude_code",
      model: (doc.model as string) || "",
      systemPrompt: (doc.system_prompt as string) || "",
      skills: (doc.skills as Skill[]) || [],
    };
  } catch {
    return null;
  }
}

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export default function AgentForm({ open, title, agent, pushEvent, onClose }: AgentFormProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [harness, setHarness] = React.useState<HarnessType>("claude_code");
  const [skills, setSkills] = React.useState<Skill[]>([]);
  const [rawMode, setRawMode] = React.useState(false);
  const [rawYaml, setRawYaml] = React.useState("");

  const nameValid = name === "" || SLUG_REGEX.test(name);

  React.useEffect(() => {
    setName(agent?.name || "");
    setDescription(agent?.description || "");
    setModel(agent?.model || "");
    setSystemPrompt(agent?.system_prompt || "");
    setHarness(agent?.harness || "claude_code");
    setSkills(agent?.skills || []);
    setRawMode(false);
    setRawYaml("");
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let finalName = name;
    let recipeYaml: string;

    if (rawMode) {
      const parsed = parseRecipeYaml(rawYaml);
      if (!parsed) return;
      finalName = parsed.name || name;
      recipeYaml = rawYaml;
    } else {
      recipeYaml = buildRecipeYaml({ name, description, harness, model, systemPrompt, skills });
    }

    if (!SLUG_REGEX.test(finalName)) return;

    const event = agent ? "update-agent" : "create-agent";
    const payload: Record<string, unknown> = {
      recipe_yaml: recipeYaml,
    };
    if (agent) {
      payload.id = agent.id;
    } else {
      payload.name = finalName;
    }

    pushEvent(event, payload);
    onClose();
  };

  const handleToggleRaw = () => {
    if (rawMode) {
      const parsed = parseRecipeYaml(rawYaml);
      if (parsed) {
        setName(parsed.name);
        setDescription(parsed.description);
        setModel(parsed.model);
        setSystemPrompt(parsed.systemPrompt);
        setHarness((parsed.harness as HarnessType) || "claude_code");
        setSkills(parsed.skills);
      }
    } else {
      setRawYaml(buildRecipeYaml({ name, description, harness, model, systemPrompt, skills }));
    }
    setRawMode(!rawMode);
  };

  const addSkill = () => setSkills([...skills, { name: "", description: "", content: "" }]);
  const removeSkill = (idx: number) => setSkills(skills.filter((_, i) => i !== idx));
  const updateSkill = (idx: number, field: "name" | "description" | "content", value: string) => {
    const updated = [...skills];
    updated[idx] = { ...updated[idx], [field]: value };
    setSkills(updated);
  };
  const addReference = (skillIdx: number) => {
    const updated = [...skills];
    updated[skillIdx] = {
      ...updated[skillIdx],
      references: [...(updated[skillIdx].references || []), { name: "", content: "" }],
    };
    setSkills(updated);
  };
  const removeReference = (skillIdx: number, refIdx: number) => {
    const updated = [...skills];
    updated[skillIdx] = {
      ...updated[skillIdx],
      references: (updated[skillIdx].references || []).filter((_, i) => i !== refIdx),
    };
    setSkills(updated);
  };
  const updateReference = (skillIdx: number, refIdx: number, field: keyof SkillReference, value: string) => {
    const updated = [...skills];
    const refs = [...(updated[skillIdx].references || [])];
    refs[refIdx] = { ...refs[refIdx], [field]: value };
    updated[skillIdx] = { ...updated[skillIdx], references: refs };
    setSkills(updated);
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
                placeholder="version: 1&#10;name: my-agent&#10;harness: claude_code&#10;..."
                rows={20}
                className="font-mono text-sm"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  placeholder="my-agent"
                />
                {name && !nameValid && (
                  <p className="text-sm text-destructive">
                    Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.
                  </p>
                )}
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
              <div className="space-y-2">
                <Label htmlFor="harness">Harness</Label>
                <Select value={harness} onValueChange={(v) => setHarness(v as HarnessType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude_code">Claude Code</SelectItem>
                    <SelectItem value="pi" disabled>
                      Pi (Coming soon)
                    </SelectItem>
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
                  <Label>Skills</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addSkill}>
                    Add Skill
                  </Button>
                </div>
                {skills.map((skill, idx) => (
                  <div key={idx} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={skill.name}
                        onChange={(e) => updateSkill(idx, "name", e.target.value)}
                        placeholder="e.g. web-scraping"
                        className="flex-1"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeSkill(idx)}>
                        Remove
                      </Button>
                    </div>
                    <Input
                      value={skill.description}
                      onChange={(e) => updateSkill(idx, "description", e.target.value)}
                      placeholder="When to use this skill..."
                    />
                    <Textarea
                      value={skill.content}
                      onChange={(e) => updateSkill(idx, "content", e.target.value)}
                      placeholder="Markdown instructions..."
                      rows={6}
                      className="font-mono text-sm"
                    />
                    <div className="space-y-2 pl-3 border-l-2 border-border">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">References</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={() => addReference(idx)}>
                          Add Reference
                        </Button>
                      </div>
                      {(skill.references || []).map((ref, refIdx) => (
                        <div key={refIdx} className="rounded border border-border p-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              value={ref.name}
                              onChange={(e) => updateReference(idx, refIdx, "name", e.target.value)}
                              placeholder="e.g. api-patterns.md"
                              className="flex-1 text-sm"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeReference(idx, refIdx)}
                            >
                              Remove
                            </Button>
                          </div>
                          <Textarea
                            value={ref.content}
                            onChange={(e) => updateReference(idx, refIdx, "content", e.target.value)}
                            placeholder="Reference content..."
                            rows={3}
                            className="font-mono text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {skills.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No skills defined. Add skills to give the agent specialized knowledge.
                  </p>
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
