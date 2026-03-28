import { watch, type FSWatcher } from "fs";
import { readFile, readdir, rename, unlink, writeFile, mkdir, stat } from "fs/promises";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { safeYamlLoad } from "../utils/yaml";
import { bus } from "../events";
import * as agentsService from "../services/agents";
import * as workspace from "../services/workspace";
import { createHarness, type Harness, type HarnessType } from "./harness";
import type { AgentEvent } from "./harness/types";

export type AgentStatus = "idle" | "bootstrapping" | "active" | "crashed";

const MAX_AUTO_RESTARTS = 3;

interface AgentManagerOpts {
  projectId: string;
  agentId: string;
  agentName: string;
}

interface MessageEnvelope {
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

interface OutboxMessage {
  to: string;
  text: string;
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
}) {
  const base = { id: msg.id, role: msg.role, ts: msg.createdAt };
  const content = msg.content as Record<string, unknown>;

  switch (msg.role) {
    case "tool_use":
      return {
        ...base,
        tool: content.tool,
        tool_use_id: content.tool_use_id,
        input: content.input,
        output: content.output,
        isError: content.is_error ?? false,
      };
    case "inter_agent":
      return { ...base, text: content.text, fromAgent: content.fromAgent };
    default:
      return { ...base, text: content.text, attachments: content.attachments ?? [] };
  }
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

function mimeFromPath(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export class AgentManager {
  readonly projectId: string;
  readonly agentId: string;
  agentName: string;
  status: AgentStatus = "idle";

  private harness: Harness | null = null;
  private streamingText: string | null = null;
  private toolUseIds = new Map<string, number>();
  private autoRestartCount = 0;
  private lastReadMessageId: number | null = null;
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
    this.initLastRead();
  }

  private initLastRead(): void {
    const id = agentsService.latestAgentMessageId(this.agentId);
    if (id !== null) this.lastReadMessageId = id;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    this.setStatus("bootstrapping");
    try {
      await this.setupWorkspace();
      await this.startHarness();
      this.startWatchers();
      this.setStatus("active");

      // Process any existing inbox messages (no subscriber at cold boot, skip broadcast)
      await this.processInbox();
    } catch (err) {
      console.error(`Bootstrap failed for ${this.agentName}:`, err);
      this.setStatus("idle");
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
    this.setStatus("idle");
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
    opts: { attachments?: Array<Record<string, unknown>> } = {},
  ): Promise<
    | { ok: true; message: ReturnType<typeof agentsService.createMessage> | null }
    | { ok: false; error: string }
  > {
    if (this.status !== "active") {
      return { ok: false, error: "Agent not active" };
    }

    const attachments = opts.attachments ?? [];

    // Build text with attachment references
    let messageText = text;
    if (attachments.length > 0) {
      const refs = attachments
        .map((a) => {
          const path = workspace.attachmentPath(
            this.projectId,
            this.agentId,
            a.id as string,
            a.filename as string,
          );
          return `[Attached file: ${a.filename} (${a.content_type}) at ${path}]`;
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
        content: attachments.length > 0 ? { text, attachments } : { text },
      });
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
    if (this.status !== "active" || !this.harness) return false;
    await this.harness.interrupt();
    return true;
  }

  async clearSession(): Promise<boolean> {
    if (this.status !== "active" || !this.harness) return false;
    await this.harness.clearSession();
    agentsService.setSessionId(this.agentId, null);
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

  markRead(messageId: number): void {
    const current = this.lastReadMessageId ?? 0;
    this.lastReadMessageId = Math.max(current, messageId);
  }

  getLastReadMessageId(): number | null {
    return this.lastReadMessageId;
  }

  // --- Harness setup ---

  private async startHarness(): Promise<void> {
    const agent = agentsService.getAgent(this.agentId);
    if (!agent) throw new Error("Agent not found in DB");

    const harnessType = (agent.harness as HarnessType) ?? "claude_code";
    const model = agent.model ?? "claude-sonnet-4-6";
    const systemPrompt = agent.systemPrompt ?? "";
    const maxTokens = agent.maxTokens ?? 16384;

    const agentDir = workspace.agentDir(this.projectId, this.agentId);
    const internalMdPath = join(agentDir, "INTERNAL.md");
    let internalSystemPrompt = "";
    try {
      internalSystemPrompt = readFileSync(internalMdPath, "utf-8");
    } catch {
      // INTERNAL.md may not exist yet
    }

    this.harness = createHarness(harnessType);
    this.harness.onEvent((event: AgentEvent) => this.handleHarnessEvent(event));
    await this.harness.start({
      model,
      systemPrompt,
      internalSystemPrompt,
      cwd: agentDir,
      maxTokens,
      resume: agent.sessionId ?? undefined,
    });

    this.autoRestartCount = 0;
  }

  // --- Harness event handling ---

  private handleHarnessEvent(event: AgentEvent): void {
    const { type, payload } = event;

    switch (type) {
      case "text_delta":
        this.handleTextDelta(payload);
        break;
      case "tool_use":
        this.handleToolUse(payload);
        break;
      case "tool_result":
        this.handleToolResult(payload);
        break;
      case "text":
        this.handleText(payload);
        break;
      case "turn_complete": {
        this.flushStreaming();
        const sessionId = payload.session_id as string | undefined;
        if (sessionId) {
          agentsService.setSessionId(this.agentId, sessionId);
        }
        this.broadcastAgent({ type: "turn_complete", payload: {} });
        break;
      }
      case "error":
        this.handleError(payload);
        break;
      default:
        this.broadcastAgent({ type, payload });
    }
  }

  private handleTextDelta(payload: Record<string, unknown>): void {
    const delta = (payload.delta as string) ?? "";
    this.streamingText = (this.streamingText ?? "") + delta;
    this.broadcastAgent({ type: "text_delta", payload: { delta } });
  }

  private handleToolUse(payload: Record<string, unknown>): void {
    const status = payload.status as string;
    const toolUseId = (payload.tool_use_id as string) ?? "";
    const tool = (payload.tool as string) ?? "unknown";
    const input = (payload.input as Record<string, unknown>) ?? {};

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
          const content = existing.content as Record<string, unknown>;
          agentsService.updateMessage(dbId, { content: { ...content, input } });
        }
      }
      this.broadcastAgent({ type: "tool_use", payload });
    } else {
      this.broadcastAgent({ type: "tool_use", payload });
    }
  }

  private handleToolResult(payload: Record<string, unknown>): void {
    const toolUseId = (payload.tool_use_id as string) ?? "";
    const output = payload.output ?? "";
    const isError = payload.is_error ?? false;

    const dbId = this.toolUseIds.get(toolUseId);
    if (dbId !== undefined) {
      const existing = agentsService.getMessage(dbId);
      if (existing) {
        const content = existing.content as Record<string, unknown>;
        agentsService.updateMessage(dbId, { content: { ...content, output, is_error: isError } });
      }
      this.toolUseIds.delete(toolUseId);
    }
    this.broadcastAgent({ type: "tool_result", payload });
  }

  private handleText(payload: Record<string, unknown>): void {
    const text = (payload.text as string) ?? "";
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

  private handleError(payload: Record<string, unknown>): void {
    this.flushStreaming();
    const errorMsg = (payload.message as string) ?? "Unknown error";
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
      let msg: OutboxMessage;
      try {
        const raw = await readFile(path, "utf-8");
        msg = safeYamlLoad(raw) as OutboxMessage;
      } catch (err) {
        await this.writeSystemInbox(`Your outbox message "${file}" could not be parsed: ${err}`);
        await unlink(path);
        continue;
      }

      if (!msg || typeof msg.to !== "string" || typeof msg.text !== "string") {
        await this.writeSystemInbox(
          `Your outbox message "${file}" is missing required "to" and/or "text" fields.`,
        );
        await unlink(path);
        continue;
      }

      // Emit outbox event — coordinator handles the actual routing
      bus.emit(`project:${this.projectId}:outbox`, {
        type: "outbox_message",
        payload: {
          fromAgentId: this.agentId,
          fromAgentName: this.agentName,
          toAgentName: msg.to,
          text: msg.text,
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
    workspace.ensureAgentDirs(this.projectId, this.agentId);
    const agentDir = workspace.agentDir(this.projectId, this.agentId);

    writeFileSync(join(agentDir, "INTERNAL.md"), this.buildInternalPrompt(), "utf-8");
  }

  private buildInternalPrompt(): string {
    const peersPath = workspace.peersPath(this.projectId);
    const outboxPath = join(
      workspace.agentDir(this.projectId, this.agentId),
      "outbox/<any-name>.yaml",
    );
    const sharedPath = workspace.sharedDir(this.projectId);
    const projectDoc = workspace.projectDocPath(this.projectId);

    return `# Inter-Agent Communication

You are **${this.agentName}**, one of several agents running in a shared environment.

## First Responder Rule
When the user sends you a message, YOU are the lead for that task:
- You are responsible for delivering the final result to the user
- Delegate to other agents when they have capabilities you lack
- When you receive replies, synthesize their input and present the final answer
- The user sees YOUR output, not the other agents' — always produce the complete response

## Discovering Peers
Read \`${peersPath}\` to see available agents and their descriptions.

## Sending Messages
To message another agent, write a YAML file to your **outbox**:

**Path:** \`${outboxPath}\`

**Format:**
\`\`\`yaml
to: target-agent-name
text: Your message here
\`\`\`

Quote the \`text\` value if it contains special YAML characters (\`:\`, \`#\`, \`{\`, \`}\`).

The system delivers the message to the target agent automatically.
Outbox files are removed once delivered — this is expected.

## Receiving Messages
Messages arrive in your conversation automatically:
- **User messages:** sent directly by the user
- **Agent messages:** arrive prefixed with \`[Message from agent "<name>"]\`

## Your Workspace
- \`scripts/\` — Save reusable automation scripts
- \`documents/\` — Store internal documents and notes

## Attachments
Write files to \`attachments/outbox/\` to share them with the user in chat.

## Shared Drive
All agents can read and write files in \`${sharedPath}/\`.

## Project Document
Read \`${projectDoc}\` for project context before starting tasks.

## Guidelines
- Read \`${peersPath}\` before messaging to confirm the target agent exists
- Be specific about what you need from the other agent
- Don't send messages unnecessarily — only when collaboration genuinely helps
`;
  }

  // --- Broadcasting ---

  private broadcastAgent(event: Record<string, unknown>): void {
    bus.emit(`project:${this.projectId}:agent:${this.agentId}`, {
      type: event.type as string,
      payload: event.payload,
      message: event.message,
    });
  }

  private broadcastAgents(event: Record<string, unknown>): void {
    bus.emit(`project:${this.projectId}:agents`, {
      type: event.type as string,
      payload: event.payload,
    });
  }

  private broadcastNewMessage(msg: ReturnType<typeof agentsService.createMessage>): void {
    bus.emit(`project:${this.projectId}:agents`, {
      type: "new_message_notification",
      payload: { agentId: this.agentId, messageId: msg.id, role: msg.role },
    });
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.broadcastAgent({ type: "agent_status", payload: { agentId: this.agentId, status } });
    this.broadcastAgents({ type: "agent_status", payload: { agentId: this.agentId, status } });
  }
}
