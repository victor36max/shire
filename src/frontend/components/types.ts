export interface Project {
  id: string;
  name: string;
}

export type HarnessType = "pi" | "claude_code" | "opencode" | "codex";

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
  emoji?: string | null;
  busy: boolean;
  unreadCount: number;
  lastUserMessageAt?: string | null;
}

export interface Agent extends AgentOverview {
  description?: string;
  model?: string;
  systemPrompt?: string;
  harness?: HarnessType;
  skills?: Skill[];
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
  role?: string;
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

export type ChannelType = "discord" | "slack" | "telegram";

export type DiscordChannelConfig = { type: "discord"; webhookUrl: string };
export type SlackChannelConfig = { type: "slack"; webhookUrl: string };
export type TelegramChannelConfig = { type: "telegram"; botToken: string; chatId: string };
export type AlertChannelConfig = DiscordChannelConfig | SlackChannelConfig | TelegramChannelConfig;

export interface AlertChannel {
  id: string;
  projectId: string;
  channelType: ChannelType;
  config: AlertChannelConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const channelTypeLabel = (type: ChannelType): string => {
  switch (type) {
    case "discord":
      return "Discord";
    case "slack":
      return "Slack";
    case "telegram":
      return "Telegram";
  }
};

export const harnessLabel = (harness: HarnessType): string => {
  switch (harness) {
    case "claude_code":
      return "Claude Code";
    case "pi":
      return "Pi";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
  }
};
