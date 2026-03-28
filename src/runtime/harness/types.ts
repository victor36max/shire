export interface HarnessConfig {
  model: string;
  systemPrompt: string;
  internalSystemPrompt?: string;
  cwd: string;
  resume?: string;
}

export type AgentEvent =
  | { type: "text_delta"; payload: { delta: string } }
  | { type: "text"; payload: { text: string } }
  | {
      type: "tool_use";
      payload: {
        tool: string;
        tool_use_id: string;
        input: Record<string, unknown>;
        status: "started" | "input_ready";
      };
    }
  | { type: "tool_result"; payload: { tool_use_id: string; output: string; is_error: boolean } }
  | { type: "turn_complete"; payload: { session_id?: string } }
  | { type: "error"; payload: { message: string } };

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
