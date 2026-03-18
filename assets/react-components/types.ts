export type HarnessType = "pi" | "claude_code";

export type AgentStatus = "created" | "starting" | "bootstrapping" | "active" | "sleeping" | "failed" | "crashed";

export interface SkillReference {
  name: string;
  content: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  references?: SkillReference[];
}

export interface Agent {
  name: string;
  description?: string;
  status: AgentStatus;
  busy?: boolean;
  model?: string;
  system_prompt?: string;
  harness?: HarnessType;
  skills?: Skill[];
}

export const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "active":
      return "default";
    case "starting":
    case "bootstrapping":
      return "secondary";
    case "failed":
    case "crashed":
      return "destructive";
    case "sleeping":
      return "outline";
    default:
      return "secondary";
  }
};

export interface Secret {
  id: number;
  key: string;
}

export interface InterAgentMessage {
  id: number;
  from_agent: string;
  to_agent: string;
  text: string;
  ts: string;
}

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
  }
};
