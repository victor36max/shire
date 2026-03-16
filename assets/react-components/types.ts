export type HarnessType = "pi" | "claude_code";

export type AgentStatus = "created" | "starting" | "active" | "sleeping" | "failed" | "destroyed";

export interface Script {
  name: string;
  run: string;
}

export interface Agent {
  id: number;
  name: string;
  description?: string;
  status: AgentStatus;
  model: string | null;
  system_prompt: string | null;
  harness: HarnessType;
  recipe: string;
  is_base: boolean;
  scripts?: Script[];
}

export interface BaseRecipe {
  id: number;
  name: string;
  description?: string;
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

export interface SharedDriveFile {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
  }
};
