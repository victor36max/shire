import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Harness, HarnessConfig, EventCallback } from "./types";

type QueryFn = typeof query;

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
  private sessionId: string | null = null;
  private activeQuery: Query | null = null;
  private queryFn: QueryFn;

  constructor(queryFn?: QueryFn) {
    this.queryFn = queryFn ?? query;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    const content = from ? `[Message from agent "${from}"]\n${text}` : text;

    this.processing = true;
    try {
      const q = this.queryFn({
        prompt: content,
        options: {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          cwd: this.config.cwd,
          allowedTools: ["Bash", "Read", "Edit", "Write"],
          resume: this.sessionId ?? undefined,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        },
      });
      this.activeQuery = q;

      for await (const message of q) {
        if (this.stopped) break;
        this.handleMessage(message);
      }
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
    } finally {
      this.processing = false;
      this.activeQuery = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
      this.activeQuery.close();
      this.activeQuery = null;
    }
    this.sessionId = null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.activeQuery) {
      this.activeQuery.close();
      this.activeQuery = null;
    }
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private handleMessage(message: SDKMessage): void {
    // Capture session ID from any message that has one
    if ("session_id" in message && message.session_id) {
      this.sessionId = message.session_id;
    }

    switch (message.type) {
      case "stream_event": {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          this.emitEvent({
            type: "text_delta",
            payload: { delta: event.delta.text },
          });
        }
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          this.emitEvent({
            type: "tool_use",
            payload: { tool: event.content_block.name, status: "started" },
          });
        }
        break;
      }

      case "result": {
        if (message.subtype === "success") {
          this.emitEvent({ type: "text", payload: { text: message.result } });
        } else {
          this.emitEvent({
            type: "error",
            payload: { message: message.errors.join(", ") },
          });
        }
        this.emitEvent({ type: "turn_complete", payload: {} });
        break;
      }
    }
  }

  private emitEvent(event: { type: string; payload: Record<string, unknown> }): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
