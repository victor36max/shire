import type { Harness, HarnessConfig, EventCallback } from "./types";

type SpawnResult = {
  stdout: ReadableStream;
  exited: Promise<number>;
  kill: (signal?: number) => void;
};

type Spawner = (cmd: string[], opts: Record<string, unknown>) => SpawnResult;

interface ClaudeJsonLine {
  type?: string;
  session_id?: string;
  subtype?: string;
  result?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
    content_block?: { type?: string; name?: string };
  };
}

export class ClaudeCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private config: HarnessConfig | null = null;
  private sessionId: string | null = null;
  private activeProc: SpawnResult | null = null;
  private spawner: Spawner | null = null;

  /** For testing: inject a mock spawner */
  _setSpawner(spawner: Spawner): void {
    this.spawner = spawner;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    const content = from ? `[Message from agent "${from}"]\n${text}` : text;

    const args = [
      "claude",
      "-p",
      content,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--allowedTools",
      "Bash,Read,Edit,Write",
      "--model",
      this.config.model,
    ];

    if (this.config.systemPrompt) {
      args.push("--append-system-prompt", this.config.systemPrompt);
    }

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    this.processing = true;
    try {
      const spawn =
        this.spawner ||
        ((cmd: string[], opts: Record<string, unknown>) => Bun.spawn(cmd, opts) as unknown as SpawnResult);

      const proc = spawn(args, {
        cwd: this.config.cwd,
        env: process.env,
        stdout: "pipe",
      });
      this.activeProc = proc;

      // Read stdout as text stream
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          this.parseLine(line);
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        this.parseLine(buffer);
      }

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        this.emitEvent({
          type: "error",
          payload: { message: `Claude CLI exit code ${exitCode}` },
        });
      }
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
    } finally {
      this.processing = false;
      this.activeProc = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.activeProc) {
      this.activeProc.kill();
      this.activeProc = null;
    }
    this.sessionId = null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.activeProc) {
      this.activeProc.kill();
      this.activeProc = null;
    }
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private parseLine(line: string): void {
    try {
      const obj = JSON.parse(line) as ClaudeJsonLine;

      if (obj.type === "system" && obj.session_id) {
        this.sessionId = obj.session_id;
      }

      if (obj.type === "stream_event") {
        const delta = obj.event?.delta;
        if (delta?.type === "text_delta") {
          this.emitEvent({
            type: "text_delta",
            payload: { delta: delta.text },
          });
        }
        if (obj.event?.type === "content_block_start" && obj.event?.content_block?.type === "tool_use") {
          this.emitEvent({
            type: "tool_use",
            payload: {
              tool: obj.event.content_block.name,
              status: "started",
            },
          });
        }
      }

      if (obj.type === "result") {
        this.emitEvent({ type: "text", payload: { text: obj.result } });
        this.emitEvent({ type: "turn_complete", payload: {} });
        if (obj.session_id) this.sessionId = obj.session_id;
      }
    } catch {
      // Skip unparseable lines
    }
  }

  private emitEvent(event: { type: string; payload: Record<string, unknown> }): void {
    if (!this.stopped) {
      this.callback(event);
    }
  }
}
