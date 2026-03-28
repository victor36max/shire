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
import type { Agent, HarnessType } from "./types";

export interface AgentFormPayload {
  id?: string;
  name: string;
  description?: string;
  harness: HarnessType;
  model?: string;
  systemPrompt?: string;
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
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [harness, setHarness] = React.useState<HarnessType>("claude_code");

  const nameValid = name === "" || SLUG_REGEX.test(name);

  React.useEffect(() => {
    setName(agent?.name || "");
    setDescription(agent?.description || "");
    setModel(agent?.model || "");
    setSystemPrompt(agent?.systemPrompt || "");
    setHarness(agent?.harness || "claude_code");
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLUG_REGEX.test(name)) return;

    const isUpdate = Boolean(agent?.id);
    const event = isUpdate ? "update-agent" : "create-agent";
    const payload: AgentFormPayload = {
      name,
      description: description || undefined,
      harness,
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
    };
    if (isUpdate) {
      payload.id = agent!.id;
    }

    onSave(event, payload);
    onClose();
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
            <Label htmlFor="harness">Harness</Label>
            <Select
              value={harness}
              onValueChange={(v) => {
                if (v === "claude_code" || v === "pi") setHarness(v);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude_code">Claude Code</SelectItem>
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
