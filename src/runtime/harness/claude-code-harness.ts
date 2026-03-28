import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, Harness, HarnessConfig, EventCallback } from "./types";

type QueryFn = typeof query;

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
  private activeQuery: Query | null = null;
  private queryFn: QueryFn;
  private shouldResume = true;
  private sessionId: string | null = null;

  constructor(queryFn?: QueryFn) {
    this.queryFn = queryFn ?? query;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.sessionId = config.resume ?? null;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    const content = from ? `[Message from agent "${from}"]\n${text}` : text;

    const shouldResume = this.shouldResume;
    this.shouldResume = true;
    this.processing = true;
    try {
      const resumeId = shouldResume && this.sessionId ? this.sessionId : undefined;
      const q = this.queryFn({
        prompt: content,
        options: {
          model: this.config.model,
          systemPrompt: [this.config.internalSystemPrompt, this.config.systemPrompt]
            .filter(Boolean)
            .join("\n\n"),
          cwd: this.config.cwd,
          allowedTools: ["Bash", "Read", "Edit", "Write", "Skill"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          resume: resumeId,
          includePartialMessages: true,
        },
      });
      this.activeQuery = q;

      for await (const message of q) {
        if (this.stopped) break;
        this.handleMessage(message);
      }
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
      this.emitEvent({ type: "turn_complete", payload: {} });
    } finally {
      this.processing = false;
      this.activeQuery = null;
    }
  }

  async clearSession(): Promise<void> {
    this.shouldResume = false;
    this.sessionId = null;
  }

  async interrupt(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
      this.activeQuery.close();
      this.activeQuery = null;
    }
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

  getSessionId(): string | null {
    return this.sessionId;
  }

  private handleMessage(message: SDKMessage): void {
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
            payload: {
              tool: event.content_block.name,
              tool_use_id: event.content_block.id,
              input: {},
              status: "started",
            },
          });
        }
        break;
      }

      case "assistant": {
        // Extract tool calls with their inputs from the complete assistant message
        const assistantContent = message.message?.content;
        if (Array.isArray(assistantContent)) {
          for (const block of assistantContent) {
            if (block.type === "tool_use") {
              this.emitEvent({
                type: "tool_use",
                payload: {
                  tool: block.name,
                  tool_use_id: block.id,
                  input: block.input as Record<string, unknown>,
                  status: "input_ready",
                },
              });
            }
          }
        }
        break;
      }

      case "user": {
        // Extract tool results from user messages (these follow tool_use)
        const userContent = message.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "tool_result" &&
              "tool_use_id" in block &&
              typeof block.tool_use_id === "string"
            ) {
              let output = "";
              const resultContent = "content" in block ? block.content : undefined;
              if (typeof resultContent === "string") {
                output = resultContent;
              } else if (Array.isArray(resultContent)) {
                output = resultContent
                  .filter(
                    (c): c is { type: "text"; text: string } =>
                      typeof c === "object" && c !== null && "type" in c && c.type === "text",
                  )
                  .map((c) => c.text)
                  .join("\n");
              }
              const isError = "is_error" in block ? Boolean(block.is_error) : false;
              this.emitEvent({
                type: "tool_result",
                payload: {
                  tool_use_id: block.tool_use_id,
                  output: output.slice(0, 2000),
                  is_error: isError,
                },
              });
            }
          }
        }
        break;
      }

      case "result": {
        if (message.subtype === "success") {
          this.sessionId = message.session_id;
          this.emitEvent({ type: "text", payload: { text: message.result } });
          this.emitEvent({
            type: "turn_complete",
            payload: { session_id: this.sessionId },
          });
        } else {
          this.emitEvent({
            type: "error",
            payload: { message: message.errors.join(", ") },
          });
          this.emitEvent({ type: "turn_complete", payload: {} });
        }
        break;
      }
    }
  }

  private emitEvent(event: AgentEvent): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
