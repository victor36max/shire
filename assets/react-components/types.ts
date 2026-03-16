export type HarnessType = "pi" | "claude_code";

export type AgentStatus = "created" | "starting" | "active" | "sleeping" | "failed" | "destroyed";

export interface Agent {
  id: number;
  name: string;
  status: AgentStatus;
  model: string | null;
  system_prompt: string | null;
  harness: HarnessType;
}

export const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "active":
      return "default";
    case "starting":
      return "secondary";
    case "failed":
      return "destructive";
    case "sleeping":
    case "destroyed":
      return "outline";
    default:
      return "secondary";
  }
};

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
  }
};
