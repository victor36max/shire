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

interface AgentFormProps {
  open: boolean;
  title: string;
  agent: { name?: string; model?: string; system_prompt?: string } | null;
  pushEvent: (event: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

export default function AgentForm({ open, title, agent, pushEvent, onClose }: AgentFormProps) {
  const [name, setName] = React.useState(agent?.name || "");
  const [model, setModel] = React.useState(agent?.model || "");
  const [systemPrompt, setSystemPrompt] = React.useState(
    agent?.system_prompt || ""
  );

  React.useEffect(() => {
    setName(agent?.name || "");
    setModel(agent?.model || "");
    setSystemPrompt(agent?.system_prompt || "");
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushEvent("save", {
      agent: { name, model, system_prompt: systemPrompt },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent>
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
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
            />
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
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit">Save Agent</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
