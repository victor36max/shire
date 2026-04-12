import * as React from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { EmojiPicker } from "frimousse";
import type { Agent, HarnessType, Skill, SkillReference } from "./types";

export interface AgentFormPayload {
  id?: string;
  name: string;
  emoji?: string;
  description?: string;
  harness: HarnessType;
  model?: string;
  systemPrompt?: string;
  skills?: Skill[];
}

interface AgentFormProps {
  open: boolean;
  title: string;
  agent: Agent | null;
  onSave: (event: string, payload: AgentFormPayload) => void;
  onClose: () => void;
}

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export default function AgentForm({ open, title, agent, onSave, onClose }: AgentFormProps) {
  const [name, setName] = React.useState(agent?.name || "");
  const [emoji, setEmoji] = React.useState(agent?.emoji || "");
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
  const [description, setDescription] = React.useState(agent?.description || "");
  const [model, setModel] = React.useState(agent?.model || "");
  const [systemPrompt, setSystemPrompt] = React.useState(agent?.systemPrompt || "");
  const [harness, setHarness] = React.useState<HarnessType>(agent?.harness || "claude_code");
  const [skills, setSkills] = React.useState<Skill[]>(agent?.skills || []);

  const nameValid = name === "" || SLUG_REGEX.test(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLUG_REGEX.test(name)) return;

    const isUpdate = Boolean(agent?.id);
    const event = isUpdate ? "update-agent" : "create-agent";
    const payload: AgentFormPayload = {
      name,
      emoji: emoji || undefined,
      description: description || undefined,
      harness,
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
      skills: skills.length > 0 ? skills : undefined,
    };
    if (isUpdate) {
      payload.id = agent!.id;
    }

    onSave(event, payload);
    onClose();
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
  const updateReference = (
    skillIdx: number,
    refIdx: number,
    field: keyof SkillReference,
    value: string,
  ) => {
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
            {title === "New Agent"
              ? "Create a new agent to get started."
              : "Update the agent details."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="my-agent"
              aria-describedby={name && !nameValid ? "name-error" : undefined}
              aria-invalid={name !== "" && !nameValid}
            />
            {name && !nameValid && (
              <p id="name-error" className="text-sm text-destructive">
                Use lowercase letters, numbers, and hyphens only. Must start and end with a letter
                or number.
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
            <Label>Avatar</Label>
            <div className="flex items-center gap-2">
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="h-10 w-10 text-lg p-0">
                    {emoji || "🤖"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-fit p-0" align="start">
                  <EmojiPicker.Root
                    onEmojiSelect={({ emoji: e }) => {
                      setEmoji(e);
                      setEmojiPickerOpen(false);
                    }}
                    className="flex flex-col"
                  >
                    <EmojiPicker.Search
                      className="mx-2 mt-2 h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Search emoji..."
                      autoFocus
                    />
                    <EmojiPicker.Viewport className="h-[280px] overflow-y-auto overflow-x-hidden p-1">
                      <EmojiPicker.Loading>
                        <span className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                          Loading…
                        </span>
                      </EmojiPicker.Loading>
                      <EmojiPicker.Empty>
                        <span className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
                          No emoji found.
                        </span>
                      </EmojiPicker.Empty>
                      <EmojiPicker.List
                        className="select-none"
                        components={{
                          CategoryHeader: ({ category, ...props }) => (
                            <div
                              className="px-2 py-1.5 text-xs font-medium text-muted-foreground bg-popover sticky top-0"
                              {...props}
                            >
                              {category.label}
                            </div>
                          ),
                          Emoji: ({ emoji: e, ...props }) => (
                            <button
                              className="flex items-center justify-center h-8 w-8 rounded text-lg hover:bg-accent cursor-pointer"
                              {...props}
                            >
                              {e.emoji}
                            </button>
                          ),
                        }}
                      />
                    </EmojiPicker.Viewport>
                  </EmojiPicker.Root>
                </PopoverContent>
              </Popover>
              <span className="text-sm text-muted-foreground">
                {emoji ? "Click to change" : "Pick an emoji"}
              </span>
              {emoji && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEmoji("")}
                  className="text-muted-foreground"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="harness">Harness</Label>
            <Select
              value={harness}
              onValueChange={(v) => {
                if (v === "claude_code" || v === "pi" || v === "opencode" || v === "codex")
                  setHarness(v);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude_code">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="opencode">OpenCode</SelectItem>
                <SelectItem value="pi">Pi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                harness === "opencode"
                  ? "e.g. anthropic/claude-sonnet-4-6"
                  : harness === "codex"
                    ? "e.g. o4-mini"
                    : "e.g. claude-sonnet-4-6"
              }
            />
            {harness === "opencode" && (
              <p className="text-xs text-muted-foreground">
                OpenCode requires provider/model format (e.g. anthropic/claude-sonnet-4-6,
                openrouter/google/gemini-2.5-pro)
              </p>
            )}
            {harness === "codex" && (
              <p className="text-xs text-muted-foreground">
                Codex uses OpenAI models (e.g. o4-mini, gpt-4.1, codex-mini)
              </p>
            )}
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addReference(idx)}
                    >
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
