import { watch, type FSWatcher } from "fs";
import { readFile, readdir, rename, unlink, writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import yaml from "js-yaml";
import { safeYamlLoad } from "../utils/yaml";
import { mimeFromPath } from "../utils/mime";
import { bus, type AgentBusEvent, type AgentListBusEvent, type SerializedMessage } from "../events";
import * as agentsService from "../services/agents";
import * as workspace from "../services/workspace";
import * as skillsService from "../services/skills";
import { createHarness, type Harness, type HarnessType } from "./harness";
import type { AgentEvent } from "./harness/types";
import { buildInternalPrompt } from "./system-prompt";
import { getPackageRoot } from "../utils/package-root";

const MAX_AUTO_RESTARTS = 3;

interface AgentManagerOpts {
  projectId: string;
  agentId: string;
  agentName: string;
  emoji?: string | null;
}

interface MessageEnvelope {
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

interface PeerEntry {
  id: string;
  name: string;
  description: string;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function serializeMessage(msg: {
  id: number;
  role: string;
  content: Record<string, unknown>;
  createdAt: string;
}): SerializedMessage {
  const base = { id: msg.id, role: msg.role, ts: msg.createdAt };
  const { content } = msg;

  switch (msg.role) {
    case "tool_use":
      return {
        ...base,
        tool: content.tool as string | undefined,
        tool_use_id: content.tool_use_id as string | undefined,
        input: content.input as Record<string, unknown> | undefined,
        output: content.output as string | null | undefined,
        isError: (content.is_error as boolean | undefined) ?? false,
      };
    case "inter_agent":
      return {
        ...base,
        text: content.text as string | undefined,
        fromAgent: content.fromAgent as string | undefined,
      };
    default:
      return {
        ...base,
        text: content.text as string | undefined,
        attachments: (content.attachments ?? []) as SerializedMessage["attachments"],
      };
  }
}

export class AgentManager {
  readonly projectId: string;
  readonly agentId: string;
  agentName: string;
  emoji: string | null;
  running = false;

  private harness: Harness | null = null;
  private streamingText: string | null = null;
  private toolUseIds = new Map<string, number>();
  private autoRestartCount = 0;
  private lastReadMessageId: number | null = null;
  private lastUserMessageAt: string | null = null;
  busy = false;

  // Peers
  private peersNameToId = new Map<string, string>();
  private peersIdToName = new Map<string, string>();

  // File watchers
  private inboxWatcher: FSWatcher | null = null;
  private outboxWatcher: FSWatcher | null = null;
  private attachmentWatcher: FSWatcher | null = null;

  constructor(opts: AgentManagerOpts) {
    this.projectId = opts.projectId;
    this.agentId = opts.agentId;
    this.agentName = opts.agentName;
    this.emoji = opts.emoji ?? null;
    this.initLastRead();
    this.initLastUserMessage();
  }

  private initLastRead(): void {
    const id = agentsService.latestAgentMessageId(this.agentId);
    if (id !== null) this.lastReadMessageId = id;
  }

  private initLastUserMessage(): void {
    this.lastUserMessageAt = agentsService.latestUserMessageAt(this.agentId);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    try {
      await this.setupWorkspace();
      await this.startHarness();
      this.startWatchers();
      this.running = true;

      // Process any existing inbox messages in the background (fs.watch won't fire for pre-existing files)
      this.busy = true;
      this.processInbox()
        .catch((err) => console.error(`Inbox processing error for ${this.agentName}:`, err))
        .finally(() => {
          this.busy = false;
        });
    } catch (err) {
      console.error(`Bootstrap failed for ${this.agentName}:`, err);
      this.running = false;
    }
  }

  async restart(): Promise<void> {
    await this.stopInternal();
    const agent = agentsService.getAgent(this.agentId);
    if (agent) this.agentName = agent.name;
    await this.start();
  }

  autoRestart(): boolean {
    if (this.autoRestartCount >= MAX_AUTO_RESTARTS) {
      console.warn(`Skipping auto-restart for ${this.agentName}: reached max retries`);
      return false;
    }
    this.autoRestartCount++;
    this.start();
    return true;
  }

  async stop(): Promise<void> {
    await this.stopInternal();
    this.running = false;
  }

  private async stopInternal(): Promise<void> {
    this.inboxWatcher?.close();
    this.outboxWatcher?.close();
    this.attachmentWatcher?.close();
    this.inboxWatcher = null;
    this.outboxWatcher = null;
    this.attachmentWatcher = null;
    if (this.harness) {
      await this.harness.stop();
      this.harness = null;
    }
  }

  // --- Messaging ---

  async sendMessage(
    text: string,
    from: "user" | "system" = "user",
    opts: {
      attachments?: Array<{
        id: string;
        filename: string;
        content_type: string;
        size: number;
      }>;
    } = {},
  ): Promise<
    | { ok: true; message: ReturnType<typeof agentsService.createMessage> | null }
    | { ok: false; error: string }
  > {
    if (!this.running) {
      return { ok: false, error: "Agent not active" };
    }

    // Attachments are already on disk — just build metadata and message text refs
    const savedAttachments = opts.attachments ?? [];
    let messageText = text;

    if (savedAttachments.length > 0) {
      const refs = savedAttachments
        .map((sa) => {
          const path = workspace.attachmentPath(this.projectId, this.agentId, sa.id, sa.filename);
          return `[Attached file: ${sa.filename} (${sa.content_type}) at ${path}]`;
        })
        .join("\n");
      messageText = text ? `${text}\n\n${refs}` : refs;
    }

    // Persist user message to DB
    let msg: ReturnType<typeof agentsService.createMessage> | null = null;
    if (from !== "system") {
      msg = agentsService.createMessage({
        projectId: this.projectId,
        agentId: this.agentId,
        role: "user",
        content: savedAttachments.length > 0 ? { text, attachments: savedAttachments } : { text },
      });
      this.lastUserMessageAt = msg.createdAt;
    }

    // Send directly to harness (no inbox file needed for direct messages)
    const prefix = from === "system" ? "[System] " : "";
    this.busy = true;
    this.broadcastAgent({ type: "agent_busy", payload: { agentId: this.agentId, active: true } });
    this.broadcastAgents({ type: "agent_busy", payload: { agentId: this.agentId, active: true } });

    // Fire-and-forget: start harness processing in the background
    // so the HTTP response returns immediately and streaming events flow via WebSocket
    this.harness
      ?.sendMessage(prefix + messageText)
      .catch((err) => {
        console.error(`Error sending message to ${this.agentName}:`, err);
      })
      .finally(() => {
        this.busy = false;
        this.broadcastAgent({
          type: "agent_busy",
          payload: { agentId: this.agentId, active: false },
        });
        this.broadcastAgents({
          type: "agent_busy",
          payload: { agentId: this.agentId, active: false },
        });
      });

    return { ok: true, message: msg };
  }

  async interrupt(): Promise<boolean> {
    if (!this.running || !this.harness) return false;
    await this.harness.interrupt();
    return true;
  }

  async clearSession(): Promise<boolean> {
    if (!this.running || !this.harness) return false;
    if (this.busy) {
      await this.harness.interrupt();
      this.busy = false;
    }
    await this.harness.clearSession();
    agentsService.setSessionId(this.agentId, null);
    this.toolUseIds.clear();
    this.streamingText = null;
    const msg = agentsService.createMessage({
      projectId: this.projectId,
      agentId: this.agentId,
      role: "system",
      content: { text: "Session cleared" },
    });
    this.broadcastAgent({
      type: "system_message",
      payload: { text: "Session cleared" },
      message: serializeMessage(msg),
    });
    return true;
  }

  async clearHistory(): Promise<void> {
    // Interrupt and clear session if harness is running
    if (this.running && this.harness) {
      if (this.busy) {
        await this.harness.interrupt();
        this.busy = false;
      }
      await this.harness.clearSession();
      agentsService.setSessionId(this.agentId, null);
    }
    agentsService.deleteMessages(this.projectId, this.agentId);
    this.lastReadMessageId = null;
    this.lastUserMessageAt = null;
    this.toolUseIds.clear();
    this.streamingText = null;
    this.broadcastAgent({
      type: "system_message",
      payload: { text: "History cleared" },
    });
  }

  markRead(messageId: number): void {
    const current = this.lastReadMessageId ?? 0;
    this.lastReadMessageId = Math.max(current, messageId);
  }

  getLastReadMessageId(): number | null {
    return this.lastReadMessageId;
  }

  getLastUserMessageAt(): string | null {
    return this.lastUserMessageAt;
  }

  // --- Harness setup ---

  private async startHarness(): Promise<void> {
    const agent = agentsService.getAgent(this.agentId);
    if (!agent) throw new Error("Agent not found in DB");

    const harnessType: HarnessType =
      agent.harness === "pi" ||
      agent.harness === "claude_code" ||
      agent.harness === "opencode" ||
      agent.harness === "codex"
        ? agent.harness
        : "claude_code";
    const model = agent.model ?? "claude-sonnet-4-6";
    const systemPrompt = agent.systemPrompt ?? "";
    const agentDir = workspace.agentDir(this.projectId, this.agentId);
    const isCompiled = process.argv[1]?.startsWith("/$bunfs/");
    const shireCommand = isCompiled
      ? "shire"
      : `bun run ${join(getPackageRoot(__dirname, 2), "src", "cli.ts")}`;
    const internalSystemPrompt = buildInternalPrompt({
      agentName: this.agentName,
      projectId: this.projectId,
      agentId: this.agentId,
      shireCommand,
    });

    this.harness = createHarness(harnessType);
    this.harness.onEvent((event: AgentEvent) => this.handleHarnessEvent(event));
    await this.harness.start({
      model,
      systemPrompt,
      internalSystemPrompt,
      cwd: agentDir,
      resume: agent.sessionId ?? undefined,
    });

    this.autoRestartCount = 0;
  }

  // --- Harness event handling ---

  private handleHarnessEvent(event: AgentEvent): void {
    switch (event.type) {
      case "text_delta":
        this.handleTextDelta(event.payload);
        break;
      case "tool_use":
        this.handleToolUse(event.payload);
        break;
      case "tool_result":
        this.handleToolResult(event.payload);
        break;
      case "text":
        this.handleText(event.payload);
        break;
      case "turn_complete": {
        this.flushStreaming();
        if (event.payload.session_id) {
          agentsService.setSessionId(this.agentId, event.payload.session_id);
        }
        this.broadcastAgent({ type: "turn_complete", payload: {} });
        break;
      }
      case "error":
        this.handleError(event.payload);
        break;
    }
  }

  private handleTextDelta(payload: { delta: string }): void {
    this.streamingText = (this.streamingText ?? "") + payload.delta;
    this.broadcastAgent({ type: "text_delta", payload: { delta: payload.delta } });
  }

  private handleToolUse(payload: {
    tool: string;
    tool_use_id: string;
    input: Record<string, unknown>;
    status: "started" | "input_ready";
  }): void {
    const { status, tool_use_id: toolUseId, tool, input } = payload;

    if (status === "started" || (status === "input_ready" && !this.toolUseIds.has(toolUseId))) {
      this.flushStreaming();
      const msg = agentsService.createMessage({
        projectId: this.projectId,
        agentId: this.agentId,
        role: "tool_use",
        content: { tool, tool_use_id: toolUseId, input, output: null, is_error: false },
      });
      this.toolUseIds.set(toolUseId, msg.id);
      this.broadcastAgent({ type: "tool_use", payload, message: serializeMessage(msg) });
    } else if (status === "input_ready") {
      const dbId = this.toolUseIds.get(toolUseId);
      if (dbId !== undefined) {
        const existing = agentsService.getMessage(dbId);
        if (existing) {
          agentsService.updateMessage(dbId, {
            content: { ...existing.content, input },
          });
        }
      }
      this.broadcastAgent({ type: "tool_use", payload });
    } else {
      this.broadcastAgent({ type: "tool_use", payload });
    }
  }

  private handleToolResult(payload: {
    tool_use_id: string;
    output: string;
    is_error: boolean;
  }): void {
    const { tool_use_id: toolUseId, output, is_error: isError } = payload;

    const dbId = this.toolUseIds.get(toolUseId);
    if (dbId !== undefined) {
      const existing = agentsService.getMessage(dbId);
      if (existing) {
        agentsService.updateMessage(dbId, {
          content: { ...existing.content, output, is_error: isError },
        });
      }
      this.toolUseIds.delete(toolUseId);
    }
    this.broadcastAgent({ type: "tool_result", payload });
  }

  private handleText(payload: { text: string }): void {
    const { text } = payload;
    const hadStreaming = this.streamingText !== null && this.streamingText !== "";
    this.flushStreaming();

    if (hadStreaming) return; // Already persisted via flushStreaming

    const msg = agentsService.createMessage({
      projectId: this.projectId,
      agentId: this.agentId,
      role: "agent",
      content: { text },
    });
    this.broadcastAgent({ type: "text", payload: { text }, message: serializeMessage(msg) });
    this.broadcastNewMessage(msg);
  }

  private handleError(payload: { message: string }): void {
    this.flushStreaming();
    const errorMsg = payload.message ?? "Unknown error";
    console.warn(`Agent error for ${this.agentName}: ${errorMsg}`);

    const msg = agentsService.createMessage({
      projectId: this.projectId,
      agentId: this.agentId,
      role: "system",
      content: { text: `Error: ${errorMsg}` },
    });
    this.broadcastAgent({ type: "error", payload, message: serializeMessage(msg) });
    this.broadcastNewMessage(msg);
  }

  private flushStreaming(): void {
    if (!this.streamingText) {
      this.streamingText = null;
      return;
    }

    const msg = agentsService.createMessage({
      projectId: this.projectId,
      agentId: this.agentId,
      role: "agent",
      content: { text: this.streamingText },
    });
    this.broadcastAgent({
      type: "text",
      payload: { text: this.streamingText },
      message: serializeMessage(msg),
    });
    this.broadcastNewMessage(msg);
    this.streamingText = null;
  }

  // --- Inbox processing (inter-agent messages arrive here) ---

  private startWatchers(): void {
    const inboxDir = workspace.inboxDir(this.projectId, this.agentId);
    const outboxDir = workspace.outboxDir(this.projectId, this.agentId);
    const attOutboxDir = join(workspace.attachmentsDir(this.projectId, this.agentId), "outbox");

    this.inboxWatcher = watch(inboxDir, async (_event, filename) => {
      if (!filename?.endsWith(".yaml") && !filename?.endsWith(".yml")) return;
      if (this.busy) {
        await this.tryHandleInterrupt(filename);
        return;
      }
      this.busy = true;
      this.broadcastAgent({ type: "agent_busy", payload: { agentId: this.agentId, active: true } });
      this.broadcastAgents({
        type: "agent_busy",
        payload: { agentId: this.agentId, active: true },
      });
      try {
        let count: number;
        do {
          count = await this.processInbox();
        } while (count > 0);
      } finally {
        this.busy = false;
        this.broadcastAgent({
          type: "agent_busy",
          payload: { agentId: this.agentId, active: false },
        });
        this.broadcastAgents({
          type: "agent_busy",
          payload: { agentId: this.agentId, active: false },
        });
      }
    });

    let routing = false;
    this.outboxWatcher = watch(outboxDir, async (_event, filename) => {
      if ((!filename?.endsWith(".yaml") && !filename?.endsWith(".yml")) || routing) return;
      routing = true;
      try {
        let count: number;
        do {
          count = await this.processOutbox();
        } while (count > 0);
      } finally {
        routing = false;
      }
    });

    let processingAttachments = false;
    this.attachmentWatcher = watch(attOutboxDir, async () => {
      if (processingAttachments) return;
      processingAttachments = true;
      try {
        let count: number;
        do {
          count = await this.processAttachmentOutbox();
        } while (count > 0);
      } catch (err) {
        console.error(`Attachment processing error for ${this.agentName}:`, err);
      } finally {
        processingAttachments = false;
      }
    });
  }

  private async tryHandleInterrupt(filename: string): Promise<boolean> {
    const inboxDir = workspace.inboxDir(this.projectId, this.agentId);
    try {
      const path = join(inboxDir, filename);
      const raw = await readFile(path, "utf-8");
      const envelope = safeYamlLoad(raw) as MessageEnvelope;
      if (envelope.type === "interrupt") {
        await this.harness?.interrupt();
        await unlink(path);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async processInbox(): Promise<number> {
    const inboxDir = workspace.inboxDir(this.projectId, this.agentId);
    let files: string[];
    try {
      files = (await readdir(inboxDir))
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .sort();
    } catch {
      return 0;
    }

    let processed = 0;
    for (const file of files) {
      const path = join(inboxDir, file);
      try {
        const s = await stat(path);
        if (s.size === 0) continue;
        const raw = await readFile(path, "utf-8");
        const envelope = safeYamlLoad(raw) as MessageEnvelope;
        await this.processEnvelope(envelope);
        await unlink(path);
        processed++;
      } catch (err) {
        console.warn(`Failed to process inbox ${file}:`, err);
        try {
          await unlink(path);
        } catch {
          /* ok */
        }
        processed++;
      }
    }
    return processed;
  }

  private async processEnvelope(envelope: MessageEnvelope): Promise<void> {
    if (
      envelope.type === "user_message" ||
      envelope.type === "agent_message" ||
      envelope.type === "system_message"
    ) {
      let text = envelope.payload.text as string;
      const from = envelope.type === "agent_message" ? envelope.from : undefined;
      const prefix = envelope.type === "system_message" ? "[System] " : "";

      // Append attachment references
      const attachments = envelope.payload.attachments as
        | Array<{ filename: string; content_type: string; path: string }>
        | undefined;
      if (attachments?.length) {
        const refs = attachments
          .map((a) => `[Attached file: ${a.filename} (${a.content_type}) at ${a.path}]`)
          .join("\n");
        text = text ? `${text}\n\n${refs}` : refs;
      }

      // Emit received events
      if (envelope.type === "agent_message") {
        const msg = agentsService.createMessage({
          projectId: this.projectId,
          agentId: this.agentId,
          role: "inter_agent",
          content: { text, fromAgent: envelope.from, toAgent: this.agentName },
        });
        this.broadcastAgent({
          type: "inter_agent_message",
          payload: { fromAgent: envelope.from, text },
          message: serializeMessage(msg),
        });
        this.broadcastNewMessage(msg);
      } else if (envelope.type === "system_message") {
        const msg = agentsService.createMessage({
          projectId: this.projectId,
          agentId: this.agentId,
          role: "system",
          content: { text },
        });
        this.broadcastAgent({
          type: "system_message",
          payload: { text },
          message: serializeMessage(msg),
        });
      }

      await this.harness?.sendMessage(prefix + text, from);
    } else if (envelope.type === "clear_session") {
      await this.harness?.clearSession();
    } else if (envelope.type === "interrupt") {
      await this.harness?.interrupt();
    }
  }

  // --- Outbox routing (inter-agent messages sent by this agent) ---

  private async processOutbox(): Promise<number> {
    await this.loadPeers();
    const outboxDir = workspace.outboxDir(this.projectId, this.agentId);
    let files: string[];
    try {
      files = (await readdir(outboxDir))
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .sort();
    } catch {
      return 0;
    }

    let routed = 0;
    for (const file of files) {
      const path = join(outboxDir, file);
      let parsed: Record<string, unknown>;
      try {
        const raw = await readFile(path, "utf-8");
        parsed = safeYamlLoad(raw) as Record<string, unknown>;
      } catch (err) {
        await this.writeSystemInbox(`Your outbox message "${file}" could not be parsed: ${err}`);
        await unlink(path);
        continue;
      }

      if (!parsed || typeof parsed.to !== "string" || typeof parsed.text !== "string") {
        await this.writeSystemInbox(
          `Your outbox message "${file}" is missing required "to" and/or "text" fields.`,
        );
        await unlink(path);
        continue;
      }

      const { to, text, ...extra } = parsed;

      // Emit outbox event — coordinator handles the actual routing
      bus.emit(`project:${this.projectId}:outbox`, {
        type: "outbox_message",
        payload: {
          fromAgentId: this.agentId,
          fromAgentName: this.agentName,
          toAgentName: to as string,
          text: text as string,
          ...(Object.keys(extra).length > 0 ? { extra } : {}),
        },
      });
      await unlink(path);
      routed++;
    }
    return routed;
  }

  private async writeSystemInbox(text: string): Promise<void> {
    const ts = Date.now();
    const envelope: MessageEnvelope = {
      ts,
      type: "system_message",
      from: "system",
      payload: { text },
    };
    const filename = `${ts}-${randomSuffix()}.yaml`;
    const inboxDir = workspace.inboxDir(this.projectId, this.agentId);
    await writeFile(join(inboxDir, filename), yaml.dump(envelope));
  }

  // --- Attachment outbox ---

  private async processAttachmentOutbox(): Promise<number> {
    const attDir = workspace.attachmentsDir(this.projectId, this.agentId);
    const outboxDir = join(attDir, "outbox");
    let entries: string[];
    try {
      entries = (await readdir(outboxDir)).sort();
    } catch {
      return 0;
    }

    const files: Array<{ name: string; path: string; size: number }> = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const filePath = join(outboxDir, entry);
      try {
        const s = await stat(filePath);
        if (s.isFile() && s.size > 0) files.push({ name: entry, path: filePath, size: s.size });
      } catch {
        /* skip */
      }
    }
    if (files.length === 0) return 0;

    const attachmentId = `${Date.now()}-${randomSuffix()}`;
    const destDir = workspace.attachmentDir(this.projectId, this.agentId, attachmentId);
    await mkdir(destDir, { recursive: true });

    const movedFiles: Array<{ id: string; filename: string; content_type: string; size: number }> =
      [];
    for (const file of files) {
      try {
        await rename(file.path, join(destDir, file.name));
        movedFiles.push({
          id: attachmentId,
          filename: file.name,
          content_type: mimeFromPath(file.name),
          size: file.size,
        });
      } catch {
        /* skip */
      }
    }

    if (movedFiles.length > 0) {
      const msg = agentsService.createMessage({
        projectId: this.projectId,
        agentId: this.agentId,
        role: "agent",
        content: { text: "", attachments: movedFiles },
      });
      this.broadcastAgent({
        type: "attachment",
        payload: { attachments: movedFiles },
        message: serializeMessage(msg),
      });
      this.broadcastNewMessage(msg);
    }

    return movedFiles.length;
  }

  // --- Peers ---

  private async loadPeers(): Promise<void> {
    const peersPath = workspace.peersPath(this.projectId);
    try {
      const raw = await readFile(peersPath, "utf-8");
      const entries = safeYamlLoad(raw) as PeerEntry[] | null;
      this.peersNameToId.clear();
      this.peersIdToName.clear();
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry.id && entry.name) {
            this.peersNameToId.set(entry.name, entry.id);
            this.peersIdToName.set(entry.id, entry.name);
          }
        }
      }
    } catch {
      /* peers.yaml may not exist */
    }
  }

  // --- Workspace setup ---

  private async setupWorkspace(): Promise<void> {
    await workspace.ensureAgentDirs(this.projectId, this.agentId);
    const agent = agentsService.getAgent(this.agentId);
    await skillsService.ensureSkillsDir(this.projectId, this.agentId, agent?.harness ?? undefined);
  }

  // --- Broadcasting ---

  private broadcastAgent(event: AgentBusEvent): void {
    bus.emit(`project:${this.projectId}:agent:${this.agentId}`, event);
  }

  private broadcastAgents(event: AgentListBusEvent): void {
    bus.emit(`project:${this.projectId}:agents`, event);
  }

  private broadcastNewMessage(msg: ReturnType<typeof agentsService.createMessage>): void {
    bus.emit(`project:${this.projectId}:agents`, {
      type: "new_message_notification",
      payload: { agentId: this.agentId, messageId: msg.id, role: msg.role },
    });
  }
}
