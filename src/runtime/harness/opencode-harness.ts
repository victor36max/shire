import type {
  OpencodeClient,
  GlobalEvent,
  Event as OpenCodeEvent,
  ToolPart,
} from "@opencode-ai/sdk";
import type { AgentEvent, Harness, HarnessConfig, EventCallback } from "./types";

type ClientFactory = (config: HarnessConfig) => Promise<OpencodeClient>;

export class OpenCodeHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private sessionId: string | null = null;
  private sessionPending: Promise<string> | null = null;
  private config: HarnessConfig | null = null;
  private clientFactory: ClientFactory | null = null;
  private client: OpencodeClient | null = null;
  private serverClose: (() => void) | null = null;
  private sessionVersion = 0;
  private eventStreamActive = false;
  private eventStream: AsyncGenerator<GlobalEvent, unknown, unknown> | null = null;
  private accumulatedText = "";
  private seenToolStates = new Map<string, string>();
  private turnResolve: (() => void) | null = null;

  _setClientFactory(factory: ClientFactory): void {
    this.clientFactory = factory;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.sessionId = config.resume ?? null;
  }

  private async ensureClient(): Promise<OpencodeClient> {
    if (this.client) return this.client;
    if (!this.config) throw new Error("Harness not started");

    if (this.clientFactory) {
      this.client = await this.clientFactory(this.config);
      return this.client;
    }

    const { createOpencode } = await import("@opencode-ai/sdk");

    const { client, server } = await createOpencode({
      config: {
        model: this.config.model,
      },
    });

    this.serverClose = server.close;
    this.client = client;
    return this.client;
  }

  private async ensureSession(): Promise<string> {
    if (this.stopped) throw new Error("Harness is stopped");
    if (this.sessionId) return this.sessionId;
    if (!this.config) throw new Error("Harness not started");

    if (!this.sessionPending) {
      const version = this.sessionVersion;
      this.sessionPending = this.createSession().then((id) => {
        if (this.sessionVersion !== version) {
          this.sessionPending = null;
          return this.ensureSession();
        }
        if (!this.sessionId) this.sessionId = id;
        this.sessionPending = null;
        return id;
      });
    }
    return this.sessionPending;
  }

  private async createSession(): Promise<string> {
    const client = await this.ensureClient();
    if (this.config?.resume) {
      const result = await client.session.get({ path: { id: this.config.resume } });
      const id = result.data?.id;
      if (!id) throw new Error(`OpenCode session not found: ${this.config.resume}`);
      return id;
    }
    const result = await client.session.create({
      query: { directory: this.config?.cwd },
    });
    const id = result.data?.id;
    if (!id) throw new Error("Failed to create OpenCode session");
    return id;
  }

  private async ensureEventStream(): Promise<void> {
    if (this.eventStreamActive) return;
    this.eventStreamActive = true;

    const client = await this.ensureClient();
    const { stream } = await client.global.event();
    this.eventStream = stream;

    // Process events in the background
    (async () => {
      try {
        for await (const event of stream) {
          if (this.stopped) break;
          this.handleSSEEvent(event.payload);
        }
      } catch {
        // Stream closed or errored
      }
    })();
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.config) throw new Error("Harness not started");
    if (this.stopped) return;

    const content = from ? `[Message from agent "${from}"]\n${text}` : text;
    const sessionId = await this.ensureSession();
    await this.ensureEventStream();

    this.processing = true;
    this.accumulatedText = "";
    this.seenToolStates.clear();

    // Set up the turn completion promise BEFORE sending the prompt
    const turnComplete = new Promise<void>((resolve) => {
      this.turnResolve = resolve;
    });

    const systemParts = [this.config.internalSystemPrompt, this.config.systemPrompt].filter(
      Boolean,
    );
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    try {
      const client = await this.ensureClient();
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: content }],
          system,
        },
        query: { directory: this.config.cwd },
      });

      // Wait for session.idle or session.error to signal turn completion
      await turnComplete;
    } catch (err) {
      this.turnResolve = null;
      this.emitEvent({ type: "error", payload: { message: String(err) } });
      this.emitEvent({ type: "turn_complete", payload: {} });
    } finally {
      this.processing = false;
    }
  }

  private handleSSEEvent(event: OpenCodeEvent): void {
    if (this.stopped) return;

    switch (event.type) {
      case "message.part.updated": {
        const { part, delta } = event.properties;
        const sessionId = part.sessionID;
        if (sessionId && this.sessionId && sessionId !== this.sessionId) return;

        if (part.type === "text") {
          if (delta) {
            this.accumulatedText += delta;
            this.emitEvent({ type: "text_delta", payload: { delta } });
          }
        } else if (part.type === "tool") {
          this.handleToolPartUpdate(part);
        }
        break;
      }

      case "session.idle": {
        const { sessionID } = event.properties;
        if (sessionID && this.sessionId && sessionID !== this.sessionId) return;

        if (this.accumulatedText) {
          this.emitEvent({ type: "text", payload: { text: this.accumulatedText } });
        }
        this.emitEvent({
          type: "turn_complete",
          payload: { session_id: this.sessionId ?? undefined },
        });
        this.resolveTurn();
        break;
      }

      case "session.error": {
        const { sessionID, error } = event.properties;
        if (sessionID && this.sessionId && sessionID !== this.sessionId) return;

        let message = "Unknown OpenCode error";
        if (error) {
          switch (error.name) {
            case "ProviderAuthError":
            case "UnknownError":
            case "MessageAbortedError":
            case "APIError":
              message = error.data.message;
              break;
            case "MessageOutputLengthError":
              message = "Message output length exceeded";
              break;
          }
        }
        this.emitEvent({ type: "error", payload: { message } });
        this.emitEvent({ type: "turn_complete", payload: {} });
        this.resolveTurn();
        break;
      }
    }
  }

  private handleToolPartUpdate(part: ToolPart): void {
    const { callID, tool, state } = part;
    const prevStatus = this.seenToolStates.get(callID);

    const emitToolUse = () => {
      this.emitEvent({
        type: "tool_use",
        payload: {
          tool,
          tool_use_id: callID,
          input: state.input,
          status: "started",
        },
      });
    };

    if (state.status === "running" && prevStatus !== "running") {
      this.seenToolStates.set(callID, "running");
      emitToolUse();
    } else if (state.status === "completed" && prevStatus !== "completed") {
      this.seenToolStates.set(callID, "completed");
      if (!prevStatus) emitToolUse();
      this.emitEvent({
        type: "tool_result",
        payload: {
          tool_use_id: callID,
          output: state.output,
          is_error: false,
        },
      });
    } else if (state.status === "error" && prevStatus !== "error") {
      this.seenToolStates.set(callID, "error");
      if (!prevStatus) emitToolUse();
      this.emitEvent({
        type: "tool_result",
        payload: {
          tool_use_id: callID,
          output: state.error,
          is_error: true,
        },
      });
    }
  }

  private resolveTurn(): void {
    if (this.turnResolve) {
      const resolve = this.turnResolve;
      this.turnResolve = null;
      resolve();
    }
  }

  async clearSession(): Promise<void> {
    this.sessionVersion++;
    const oldSessionId = this.sessionId;
    this.sessionId = null;
    this.sessionPending = null;
    this.accumulatedText = "";
    this.seenToolStates.clear();
    // Abort the running server-side session
    if (oldSessionId && this.client) {
      await this.client.session.abort({ path: { id: oldSessionId } }).catch(() => {});
    }
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId || !this.client) return;
    await this.client.session.abort({ path: { id: this.sessionId } });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.sessionId = null;
    this.eventStreamActive = false;
    // Resolve any in-flight turn promise so sendMessage doesn't hang
    this.resolveTurn();
    // Close the event stream
    if (this.eventStream) {
      this.eventStream.return(undefined).catch(() => {});
      this.eventStream = null;
    }
    if (this.serverClose) {
      this.serverClose();
      this.serverClose = null;
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

  private emitEvent(event: AgentEvent): void {
    if (!this.stopped) this.callback(event);
  }
}
