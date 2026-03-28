export interface HarnessConfig {
  model: string;
  systemPrompt: string;
  internalSystemPrompt?: string;
  cwd: string;
  maxTokens?: number;
  resume?: string;
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
  clearSession(): Promise<void>;
  stop(): Promise<void>;
  onEvent(callback: EventCallback): void;
  isProcessing(): boolean;
  getSessionId(): string | null;
}
