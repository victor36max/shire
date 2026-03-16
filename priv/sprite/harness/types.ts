// priv/sprite/harness/types.ts
export interface HarnessConfig {
  model: string;
  systemPrompt: string;
  cwd: string;
  maxTokens?: number;
}

export interface AgentEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type EventCallback = (event: AgentEvent) => void;

export interface Harness {
  start(config: HarnessConfig): Promise<void>;
  sendMessage(text: string, from?: string): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onEvent(callback: EventCallback): void;
  isProcessing(): boolean;
}
