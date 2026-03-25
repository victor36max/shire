import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Harness, HarnessConfig, EventCallback } from "./types";

type QueryFn = typeof query;

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
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
          systemPrompt: [this.config.internalSystemPrompt, this.config.systemPrompt].filter(Boolean).join("\n\n"),
          cwd: this.config.cwd,
          allowedTools: ["Bash", "Read", "Edit", "Write", "Skill"],
          settingSources: ["project"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          continue: true,
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
        const content = (message as Record<string, unknown>).message as { content?: unknown[] } | undefined;
        if (content && Array.isArray(content.content)) {
          for (const block of content.content) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_use") {
              this.emitEvent({
                type: "tool_use",
                payload: {
                  tool: b.name as string,
                  tool_use_id: b.id as string,
                  input: b.input as Record<string, unknown>,
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
        const userMsg = (message as Record<string, unknown>).message as { content?: unknown } | undefined;
        const userContent = userMsg?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
              let output = "";
              if (typeof b.content === "string") {
                output = b.content;
              } else if (Array.isArray(b.content)) {
                output = (b.content as Record<string, unknown>[])
                  .filter((c) => c.type === "text")
                  .map((c) => c.text as string)
                  .join("\n");
              }
              this.emitEvent({
                type: "tool_result",
                payload: {
                  tool_use_id: b.tool_use_id,
                  output: output.slice(0, 2000),
                  is_error: (b.is_error as boolean) ?? false,
                },
              });
            }
          }
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
