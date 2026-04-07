import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type { AgentEvent, EventCallback, Harness, HarnessConfig } from "./types";

type CodexFactory = () => Codex;

type CodexThread = ReturnType<Codex["startThread"]>;

export class CodexHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
  private codex: Codex | null = null;
  private codexFactory: CodexFactory;
  private thread: CodexThread | null = null;
  private threadId: string | null = null;
  private abortController: AbortController | null = null;
  private accumulatedText = "";
  private firstMessage = true;

  constructor(codexFactory?: CodexFactory) {
    this.codexFactory = codexFactory ?? (() => new Codex());
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.threadId = config.resume ?? null;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    let content = from ? `[Message from agent "${from}"]\n${text}` : text;

    // Codex SDK ThreadOptions has no instructions parameter, so prepend system prompt
    // to the first message in the thread to establish agent context
    if (this.firstMessage) {
      this.firstMessage = false;
      const systemPrompt = [this.config.internalSystemPrompt, this.config.systemPrompt]
        .filter(Boolean)
        .join("\n\n");
      if (systemPrompt) {
        content = `[System Instructions]\n${systemPrompt}\n\n[User Message]\n${content}`;
      }
    }

    this.processing = true;
    this.accumulatedText = "";
    this.abortController = new AbortController();

    try {
      this.ensureThread();
      const { events } = await this.thread!.runStreamed(content, {
        signal: this.abortController.signal,
      });

      for await (const event of events) {
        if (this.stopped) break;
        this.handleEvent(event);
      }
    } catch (err) {
      if (!this.stopped) {
        this.emitEvent({ type: "error", payload: { message: String(err) } });
        this.emitEvent({ type: "turn_complete", payload: {} });
      }
    } finally {
      this.processing = false;
      this.abortController = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async clearSession(): Promise<void> {
    this.thread = null;
    this.threadId = null;
    this.firstMessage = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.thread = null;
    this.codex = null;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  getSessionId(): string | null {
    return this.threadId;
  }

  // --- Private helpers ---

  private ensureThread(): void {
    if (!this.config) throw new Error("Harness not started");

    if (!this.codex) {
      this.codex = this.codexFactory();
    }

    if (!this.thread) {
      const threadOpts: ThreadOptions = {
        model: this.config.model,
        workingDirectory: this.config.cwd,
        sandboxMode: "danger-full-access",
        skipGitRepoCheck: true,
        approvalPolicy: "never",
      };

      if (this.threadId) {
        this.thread = this.codex.resumeThread(this.threadId, threadOpts);
      } else {
        this.thread = this.codex.startThread(threadOpts);
      }
    }
  }

  private handleEvent(event: ThreadEvent): void {
    switch (event.type) {
      case "thread.started": {
        this.threadId = event.thread_id;
        break;
      }

      case "item.started": {
        const item = event.item;
        if (item.type === "command_execution") {
          this.emitEvent({
            type: "tool_use",
            payload: {
              tool: "command_execution",
              tool_use_id: item.id,
              input: { command: item.command },
              status: "started",
            },
          });
        } else if (item.type === "file_change") {
          this.emitEvent({
            type: "tool_use",
            payload: {
              tool: "file_change",
              tool_use_id: item.id,
              input: {},
              status: "started",
            },
          });
        } else if (item.type === "mcp_tool_call") {
          const args =
            typeof item.arguments === "object" && item.arguments !== null
              ? (item.arguments as Record<string, unknown>)
              : {};
          this.emitEvent({
            type: "tool_use",
            payload: {
              tool: item.tool,
              tool_use_id: item.id,
              input: args,
              status: "started",
            },
          });
        }
        break;
      }

      case "item.completed": {
        const item = event.item;
        if (item.type === "agent_message") {
          this.accumulatedText += item.text;
          this.emitEvent({
            type: "text_delta",
            payload: { delta: item.text },
          });
        } else if (item.type === "command_execution") {
          this.emitEvent({
            type: "tool_result",
            payload: {
              tool_use_id: item.id,
              output: item.aggregated_output.slice(0, 2000),
              is_error: item.exit_code !== undefined && item.exit_code !== 0,
            },
          });
        } else if (item.type === "file_change") {
          const summary = item.changes.map((c) => `${c.kind}: ${c.path}`).join(", ");
          this.emitEvent({
            type: "tool_result",
            payload: {
              tool_use_id: item.id,
              output: summary,
              is_error: item.status === "failed",
            },
          });
        } else if (item.type === "mcp_tool_call") {
          let output = "";
          if (item.result?.content) {
            output = item.result.content
              .filter(
                (c): c is { type: "text"; text: string } =>
                  typeof c === "object" && c !== null && "type" in c && c.type === "text",
              )
              .map((c) => c.text)
              .join("\n");
          }
          if (item.error) {
            output = item.error.message;
          }
          this.emitEvent({
            type: "tool_result",
            payload: {
              tool_use_id: item.id,
              output: output.slice(0, 2000),
              is_error: item.status === "failed",
            },
          });
        } else if (item.type === "error") {
          this.emitEvent({
            type: "error",
            payload: { message: item.message },
          });
        }
        break;
      }

      case "turn.completed": {
        if (this.accumulatedText) {
          this.emitEvent({
            type: "text",
            payload: { text: this.accumulatedText },
          });
        }
        this.emitEvent({
          type: "turn_complete",
          payload: { session_id: this.threadId ?? undefined },
        });
        break;
      }

      case "turn.failed": {
        this.emitEvent({
          type: "error",
          payload: { message: event.error.message },
        });
        this.emitEvent({ type: "turn_complete", payload: {} });
        break;
      }

      case "error": {
        this.emitEvent({
          type: "error",
          payload: { message: event.message },
        });
        this.emitEvent({ type: "turn_complete", payload: {} });
        break;
      }

      // turn.started, item.updated — no mapping needed
    }
  }

  private emitEvent(event: AgentEvent): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
