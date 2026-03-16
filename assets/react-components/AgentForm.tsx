import * as React from "react";
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
import type { HarnessType } from "./types";

interface AgentFormProps {
  open: boolean;
  title: string;
  agent: { name?: string; model?: string; system_prompt?: string; harness?: HarnessType } | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

export default function AgentForm({ open, title, agent, pushEvent, onClose }: AgentFormProps) {
  const [name, setName] = React.useState(agent?.name || "");
  const [model, setModel] = React.useState(agent?.model || "");
  const [systemPrompt, setSystemPrompt] = React.useState(agent?.system_prompt || "");
  const [harness, setHarness] = React.useState(agent?.harness || "pi");

  React.useEffect(() => {
    setName(agent?.name || "");
    setModel(agent?.model || "");
    setSystemPrompt(agent?.system_prompt || "");
    setHarness(agent?.harness || "pi");
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushEvent("save", {
      agent: { name, model, system_prompt: systemPrompt, harness },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {title === "New Agent" ? "Create a new agent to get started." : "Update the agent details."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="harness">Harness</Label>
            <select
              id="harness"
              value={harness}
              onChange={(e) => setHarness(e.target.value as HarnessType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="pi">Pi</option>
              <option value="claude_code">Claude Code</option>
            </select>
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
