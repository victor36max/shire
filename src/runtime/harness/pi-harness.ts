import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentEvent, Harness, HarnessConfig, EventCallback } from "./types";

type SessionFactory = (config: HarnessConfig) => Promise<AgentSession>;

export class PiHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private session: AgentSession | null = null;
  private sessionPending: Promise<AgentSession> | null = null;
  private config: HarnessConfig | null = null;
  private sessionFactory: SessionFactory | null = null;
  private skipContinue = false;
  private sessionVersion = 0;

  _setSessionFactory(factory: SessionFactory): void {
    this.sessionFactory = factory;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
  }

  private async ensureSession(): Promise<AgentSession> {
    if (this.stopped) throw new Error("Harness is stopped");
    if (this.session) return this.session;
    if (!this.config) throw new Error("Harness not started");
    if (!this.sessionPending) {
      const version = this.sessionVersion;
      this.sessionPending = this.createSession(this.config).then((s) => {
        // If clearSession() was called while we were creating, discard this session
        if (this.sessionVersion !== version) {
          this.sessionPending = null;
          return this.ensureSession();
        }
        this.subscribeToSession(s);
        if (!this.session) this.session = s;
        this.sessionPending = null;
        return s;
      });
    }
    return this.sessionPending;
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    const session = await this.ensureSession();
    const content = from ? `[Message from agent "${from}"]\n${text}` : text;
    this.processing = true;
    try {
      await session.prompt(content);
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
      this.emitEvent({ type: "turn_complete", payload: {} });
    } finally {
      this.processing = false;
    }
  }

  async clearSession(): Promise<void> {
    this.sessionVersion++;
    const old = this.session ?? (await this.sessionPending?.catch(() => null));
    this.session = null;
    this.sessionPending = null;
    this.skipContinue = true;
    if (old) await old.abort().catch(() => {});
  }

  async interrupt(): Promise<void> {
    if (!this.session) return;
    await this.session.abort();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.session = null;
  }

  onEvent(callback: EventCallback): void {
    this.callback = callback;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  getSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  private async createSession(config: HarnessConfig): Promise<AgentSession> {
    if (this.sessionFactory) return this.sessionFactory(config);

    const {
      createAgentSession,
      AuthStorage,
      ModelRegistry,
      createCodingTools,
      SessionManager,
      SettingsManager,
      DefaultResourceLoader,
    } = await import("@mariozechner/pi-coding-agent");

    const authStorage = AuthStorage.inMemory();
    const modelRegistry = new ModelRegistry(authStorage);
    const model = modelRegistry.getAvailable().find((m) => m.id === config.model);
    if (!model) throw new Error(`Model not found or no API key configured: ${config.model}`);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const loader = new DefaultResourceLoader({
      cwd: config.cwd,
      additionalSkillPaths: [join(homedir(), ".agents", "skills")],
      settingsManager,
      systemPromptOverride: (base) => {
        const parts = [base, config.internalSystemPrompt, config.systemPrompt].filter(Boolean);
        return parts.length > 0 ? parts.join("\n\n") : undefined;
      },
    });
    await loader.reload();

    let sessionManager: ReturnType<typeof SessionManager.continueRecent> | undefined;
    if (this.skipContinue) {
      sessionManager = undefined;
    } else if (config.resume) {
      try {
        const sessions = await SessionManager.list(config.cwd);
        const match = sessions.find((s) => s.id === config.resume);
        if (match) {
          sessionManager = SessionManager.open(match.path);
        }
      } catch {
        // Session not found, start fresh
      }
    } else {
      sessionManager = SessionManager.continueRecent(config.cwd);
    }

    console.error(
      `[pi-harness] creating session with model ${model.provider}/${model.id}, cwd ${config.cwd}`,
    );
    const { session } = await createAgentSession({
      cwd: config.cwd,
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      tools: createCodingTools(config.cwd),
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    this.skipContinue = false;
    return session;
  }

  private subscribeToSession(session: AgentSession): void {
    console.error("[pi-harness] subscribed to session events");
    session.subscribe((event: AgentSessionEvent) => {
      console.error(`[pi-harness] session event: ${event.type}`);
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            this.emitEvent({
              type: "text_delta",
              payload: { delta: event.assistantMessageEvent.delta },
            });
          }
          break;
        case "message_end": {
          if (event.message.role !== "assistant") break;
          const content = event.message.content;
          const text = Array.isArray(content)
            ? content
                .filter(
                  (b): b is { type: "text"; text: string } => b.type === "text" && "text" in b,
                )
                .map((b) => b.text)
                .join("")
            : typeof content === "string"
              ? content
              : "";
          this.emitEvent({ type: "text", payload: { text } });
          break;
        }
        case "tool_execution_start":
          this.emitEvent({
            type: "tool_use",
            payload: {
              tool: event.toolName,
              tool_use_id: event.toolCallId,
              input: event.args ?? {},
              status: "started",
            },
          });
          break;
        case "tool_execution_end":
          this.emitEvent({
            type: "tool_result",
            payload: {
              tool_use_id: event.toolCallId,
              output:
                typeof event.result === "string" ? event.result : JSON.stringify(event.result),
              is_error: event.isError ?? false,
            },
          });
          break;
        case "agent_end":
          this.emitEvent({
            type: "turn_complete",
            payload: { session_id: this.session?.sessionId },
          });
          break;
      }
    });
  }

  private emitEvent(event: AgentEvent): void {
    if (!this.stopped) this.callback(event);
  }
}
