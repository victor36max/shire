export interface Project {
  id: string;
  name: string;
  status: "starting" | "running" | "idle" | "unreachable" | "stopped" | "error";
}

export type HarnessType = "pi" | "claude_code";

export type AgentStatus = "created" | "starting" | "bootstrapping" | "active" | "idle" | "crashed";

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

export interface AgentOverview {
  id: string;
  name: string;
  status: AgentStatus;
  busy: boolean;
  unreadCount: number;
}

export interface Agent extends AgentOverview {
  description?: string;
  model?: string;
  systemPrompt?: string;
  harness?: HarnessType;
  skills?: Skill[];
  maxTokens?: number;
}

export interface CatalogAgentSummary {
  name: string;
  displayName: string;
  description: string;
  category: string;
  emoji: string;
  tags: string[];
  harness: HarnessType;
  model: string;
}

export interface CatalogAgent extends CatalogAgentSummary {
  systemPrompt: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
}

export const statusVariant = (
  status: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "active":
      return "default";
    case "starting":
    case "bootstrapping":
      return "secondary";
    case "idle":
      return "outline";
    case "crashed":
      return "destructive";
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
  fromAgent: string;
  toAgent: string;
  text: string;
  ts: string;
  trigger?: string;
  taskLabel?: string;
}

export interface ScheduledTask {
  id: string;
  label: string;
  agentId: string;
  agentName: string;
  message: string;
  scheduleType: "once" | "recurring";
  cronExpression: string | null;
  scheduledAt: string | null;
  enabled: boolean;
  lastRunAt: string | null;
}

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
  }
};
