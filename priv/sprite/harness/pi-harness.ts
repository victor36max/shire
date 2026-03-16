import type { AgentSessionEvent, AgentSessionEventListener } from "@mariozechner/pi-coding-agent";
import type { Harness, HarnessConfig, EventCallback } from "./types";

export type SessionLike = {
  subscribe: (cb: AgentSessionEventListener) => void;
  prompt: (text: string) => Promise<void>;
};

type SessionFactory = (config: HarnessConfig) => Promise<SessionLike>;

export class PiHarness implements Harness {
  private callback: EventCallback = () => {};
  private processing = false;
  private stopped = false;
  private session: SessionLike | null = null;
  private config: HarnessConfig | null = null;
  private sessionFactory: SessionFactory | null = null;

  _setSessionFactory(factory: SessionFactory): void {
    this.sessionFactory = factory;
  }

  async start(config: HarnessConfig): Promise<void> {
    this.config = config;
    this.stopped = false;
    this.session = await this.createSession(config);
    this.subscribeToSession(this.session);
  }

  async sendMessage(text: string, from?: string): Promise<void> {
    if (!this.session) throw new Error("Harness not started");
    const content = from ? `[Message from agent "${from}"]\n${text}` : text;
    this.processing = true;
    try {
      await this.session.prompt(content);
    } catch (err) {
      this.emitEvent({ type: "error", payload: { message: String(err) } });
    } finally {
      this.processing = false;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.config) return;
    this.session = await this.createSession(this.config);
    this.subscribeToSession(this.session);
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

  private async createSession(config: HarnessConfig): Promise<SessionLike> {
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
    const { getModel } = await import("@mariozechner/pi-ai");

    const authStorage = AuthStorage.create();
    if (process.env.ANTHROPIC_API_KEY) {
      authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
    }
    const modelRegistry = new ModelRegistry(authStorage);
    const [provider, modelName] = config.model.split("/");
    const model = getModel(provider, modelName);
    if (!model) throw new Error(`Model not found: ${config.model}`);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const loader = new DefaultResourceLoader({
      cwd: config.cwd,
      settingsManager,
      systemPromptOverride: () => config.systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: config.cwd,
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      tools: createCodingTools(config.cwd),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });
    return session;
  }

  private subscribeToSession(session: SessionLike): void {
    session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            this.emitEvent({ type: "text_delta", payload: { delta: event.assistantMessageEvent.delta } });
          }
          break;
        case "message_end": {
          const content = event.message?.content;
          const text = Array.isArray(content)
            ? content
                .filter((b): b is { type: "text"; text: string } => b.type === "text" && "text" in b)
                .map((b) => b.text)
                .join("")
            : typeof content === "string"
              ? content
              : "";
          this.emitEvent({ type: "text", payload: { text } });
          break;
        }
        case "tool_execution_start":
          this.emitEvent({ type: "tool_use", payload: { tool: event.toolName, status: "started" } });
          break;
        case "tool_execution_end":
          this.emitEvent({
            type: "tool_use",
            payload: { tool: event.toolName, status: "completed", result: event.result },
          });
          break;
        case "agent_end":
          this.emitEvent({ type: "turn_complete", payload: {} });
          break;
      }
    });
  }

  private emitEvent(event: { type: string; payload: Record<string, unknown> }): void {
    if (!this.stopped) this.callback(event);
  }
}
