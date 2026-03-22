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

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  busy?: boolean;
  model?: string;
  system_prompt?: string;
  harness?: HarnessType;
  skills?: Skill[];
}

export interface CatalogAgentSummary {
  name: string;
  display_name: string;
  description: string;
  category: string;
  emoji: string;
  tags: string[];
  harness: HarnessType;
  model: string;
}

export interface CatalogAgent extends CatalogAgentSummary {
  system_prompt: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
}

export const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
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
  from_agent: string;
  to_agent: string;
  text: string;
  ts: string;
  trigger?: string;
  task_label?: string;
}

export interface ScheduledTask {
  id: string;
  label: string;
  agent_id: string;
  agent_name: string;
  message: string;
  schedule_type: "once" | "recurring";
  cron_expression: string | null;
  scheduled_at: string | null;
  enabled: boolean;
  last_run_at: string | null;
}

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
  }
};
