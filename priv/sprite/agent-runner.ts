// agent-runner.ts — Bun daemon that watches the inbox/outbox and dispatches to configured harness.
// Each agent runs in its own workspace directory under /workspace/agents/{id}/.
import { watch } from "fs";
import { readFile, readdir, rename, unlink, writeFile, mkdir, stat } from "fs/promises";
import { basename, join } from "path";
import { parseArgs } from "util";
import yaml from "js-yaml";
import { createHarness, type Harness, type HarnessType } from "./harness";

// Parse --agent-dir CLI argument
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "agent-dir": { type: "string" },
  },
  strict: false,
});

const AGENT_DIR = (typeof values["agent-dir"] === "string" ? values["agent-dir"] : null) || "/workspace/agents/default";
const INBOX_DIR = join(AGENT_DIR, "inbox");
const OUTBOX_DIR = join(AGENT_DIR, "outbox");
const ATTACHMENTS_DIR = join(AGENT_DIR, "attachments");
const ATTACHMENT_OUTBOX_DIR = join(ATTACHMENTS_DIR, "outbox");
const AGENTS_ROOT = join(AGENT_DIR, "../");
const RECIPE_PATH = join(AGENT_DIR, "recipe.yaml");
const PEERS_PATH = join(AGENTS_ROOT, "../peers.yaml");

export interface AgentConfig {
  harness: HarnessType;
  model: string;
  system_prompt: string;
  max_tokens?: number;
}

export interface MessageEnvelope {
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

export interface OutboxMessage {
  to: string;
  text: string;
}

export interface PeerEntry {
  id: string;
  name: string;
  description: string;
}

export function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
}

// ---------------------------------------------------------------------------
// Peers management
// ---------------------------------------------------------------------------

let peersNameToId: Map<string, string> = new Map();
let peersIdToName: Map<string, string> = new Map();

export async function loadPeers(peersPath = PEERS_PATH): Promise<void> {
  try {
    const raw = await readFile(peersPath, "utf-8");
    const entries = yaml.load(raw) as PeerEntry[] | null;
    const nameToId = new Map<string, string>();
    const idToName = new Map<string, string>();

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry.id && entry.name) {
          nameToId.set(entry.name, entry.id);
          idToName.set(entry.id, entry.name);
        }
      }
    }

    peersNameToId = nameToId;
    peersIdToName = idToName;
  } catch {
    // peers.yaml may not exist yet
  }
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

export async function loadConfig(path = RECIPE_PATH): Promise<AgentConfig> {
  const raw = await readFile(path, "utf-8");
  const recipe = yaml.load(raw) as Record<string, unknown>;
  return {
    harness: (recipe.harness as HarnessType) || "claude_code",
    model: (recipe.model as string) || "claude-sonnet-4-6",
    system_prompt: (recipe.system_prompt as string) || "",
    max_tokens: (recipe.max_tokens as number) || 16384,
  };
}

export function agentName(): string {
  const id = basename(AGENT_DIR);
  return peersIdToName.get(id) || id;
}

export async function tryHandleInterrupt(harness: Harness, filename: string, inboxDir = INBOX_DIR): Promise<boolean> {
  try {
    const path = join(inboxDir, filename);
    const raw = await readFile(path, "utf-8");
    const envelope = yaml.load(raw) as MessageEnvelope;
    if (envelope.type === "interrupt") {
      await harness.interrupt();
      emit("interrupted", {});
      await unlink(path);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function processMessage(harness: Harness, envelope: MessageEnvelope): Promise<void> {
  if (envelope.type === "user_message" || envelope.type === "agent_message" || envelope.type === "system_message") {
    let text = envelope.payload.text as string;
    const from = envelope.type === "agent_message" ? envelope.from : undefined;
    const prefix = envelope.type === "system_message" ? "[System] " : "";

    // Append attachment file references so the agent can access them
    const attachments = envelope.payload.attachments as
      | Array<{ filename: string; content_type: string; path: string }>
      | undefined;
    if (attachments?.length) {
      const refs = attachments.map((a) => `[Attached file: ${a.filename} (${a.content_type}) at ${a.path}]`).join("\n");
      text = text ? `${text}\n\n${refs}` : refs;
    }

    if (envelope.type === "agent_message") {
      emit("agent_message_received", { from_agent: envelope.from, text });
    } else if (envelope.type === "system_message") {
      emit("system_message_received", { text });
    }
    await harness.sendMessage(prefix + text, from);
  } else if (envelope.type === "interrupt") {
    await harness.interrupt();
    emit("interrupted", {});
  }
}

export async function processInbox(harness: Harness, inboxDir = INBOX_DIR): Promise<number> {
  const files = await readdir(inboxDir);
  const sorted = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();

  for (const file of sorted) {
    const path = join(inboxDir, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope = yaml.load(raw) as MessageEnvelope;
      await processMessage(harness, envelope);
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
      try {
        await unlink(path);
      } catch {
        // File may already be gone
      }
    }
  }

  return sorted.length;
}

// ---------------------------------------------------------------------------
// Outbox routing — delivers messages to target agent inboxes
// ---------------------------------------------------------------------------

export async function writeSystemMessage(inboxDir: string, text: string): Promise<void> {
  const ts = Date.now();
  const envelope: MessageEnvelope = {
    ts,
    type: "system_message",
    from: "system",
    payload: { text },
  };
  const filename = `${ts}-${Math.random().toString(36).slice(2, 6)}.yaml`;
  await writeFile(join(inboxDir, filename), yaml.dump(envelope));
}

export async function processOutbox(
  outboxDir = OUTBOX_DIR,
  agentsRoot = AGENTS_ROOT,
  peersPath = PEERS_PATH,
  inboxDir = INBOX_DIR,
): Promise<number> {
  // Reload peers on each outbox cycle to pick up changes
  await loadPeers(peersPath);

  const files = await readdir(outboxDir);
  const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();

  let routed = 0;

  for (const file of yamlFiles) {
    const path = join(outboxDir, file);

    let msg: OutboxMessage;
    try {
      const raw = await readFile(path, "utf-8");
      msg = yaml.load(raw) as OutboxMessage;
    } catch (err) {
      emit("error", { message: `Invalid outbox message ${file}: ${err}` });
      await writeSystemMessage(
        inboxDir,
        `Your outbox message "${file}" could not be parsed as YAML: ${err}. Please check the format and try again.`,
      );
      await unlink(path);
      continue;
    }

    // Validate required fields
    if (!msg || typeof msg.to !== "string" || typeof msg.text !== "string") {
      const missing: string[] = [];
      if (!msg || typeof msg.to !== "string") missing.push('"to" (string)');
      if (!msg || typeof msg.text !== "string") missing.push('"text" (string)');
      emit("error", { message: `Invalid outbox message ${file}: missing required fields: ${missing.join(", ")}` });
      await writeSystemMessage(
        inboxDir,
        `Your outbox message "${file}" is missing required fields: ${missing.join(", ")}. Each outbox message must be a valid YAML file with "to" and "text" on separate lines. Example:\nto: agent-name\ntext: Your message here`,
      );
      await unlink(path);
      continue;
    }

    // Route message — transient failures (peer not found, write error) keep file for retry
    try {
      const targetId = peersNameToId.get(msg.to);
      if (!targetId) {
        emit("error", { message: `Peer not found: "${msg.to}". Skipping message, will retry.` });
        continue; // Don't delete — retry on next cycle after peers.yaml update
      }

      const targetInbox = join(agentsRoot, targetId, "inbox");
      const ts = Date.now();
      const envelope: MessageEnvelope = {
        ts,
        type: "agent_message",
        from: agentName(),
        payload: { text: msg.text },
      };
      const filename = `${ts}-${Math.random().toString(36).slice(2, 6)}.yaml`;
      await writeFile(join(targetInbox, filename), yaml.dump(envelope));
      emit("agent_message_sent", { to_agent: msg.to, to_agent_id: targetId, text: msg.text });
      await unlink(path);
      routed++;
    } catch (err) {
      emit("error", { message: `Failed to route outbox ${file}: ${err}` });
    }
  }

  return routed;
}

// ---------------------------------------------------------------------------
// Attachments — detect agent-created files and emit events
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
};

function mimeFromPath(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function processAttachmentOutbox(attachmentsDir: string): Promise<number> {
  const outboxDir = join(attachmentsDir, "outbox");
  let entries: string[];
  try {
    entries = (await readdir(outboxDir)).sort();
  } catch {
    return 0;
  }

  // Collect regular files, skip dotfiles and directories
  const files: Array<{ name: string; path: string; size: number }> = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || entry.includes("/") || entry.includes("\\")) continue;
    const filePath = join(outboxDir, entry);
    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        files.push({ name: entry, path: filePath, size: s.size });
      }
    } catch {
      // skip unreadable entries
    }
  }

  if (files.length === 0) return 0;

  // Batch all files into one timestamped folder
  const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const destDir = join(attachmentsDir, attachmentId);
  await mkdir(destDir, { recursive: true });

  const movedFiles: Array<{ filename: string; content_type: string; size: number }> = [];

  for (const file of files) {
    const destPath = join(destDir, file.name);
    try {
      await rename(file.path, destPath);
      movedFiles.push({
        filename: file.name,
        content_type: mimeFromPath(file.name),
        size: file.size,
      });
    } catch (err) {
      emit("error", { message: `Failed to move attachment ${file.name}: ${err}` });
    }
  }

  if (movedFiles.length > 0) {
    emit("attachment", {
      id: attachmentId,
      files: movedFiles,
    });
  }

  return movedFiles.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = await loadConfig();
  await loadPeers();

  // Ensure attachments directories exist
  await mkdir(ATTACHMENT_OUTBOX_DIR, { recursive: true });

  const harness = createHarness(config.harness);

  harness.onEvent((event) => emit(event.type, event.payload));
  await harness.start({
    model: config.model,
    systemPrompt: config.system_prompt,
    cwd: AGENT_DIR,
    maxTokens: config.max_tokens,
  });

  emit("ready", { model: config.model, harness: config.harness, agentDir: AGENT_DIR });

  let processing = false;

  // Process any existing inbox messages
  const initialCount = await processInbox(harness);
  if (initialCount > 0) {
    emit("processing", { active: false });
  }

  // Watch for new inbox messages
  const inboxWatcher = watch(INBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".yaml") && !filename?.endsWith(".yml")) return;
    if (processing) {
      await tryHandleInterrupt(harness, filename);
      return;
    }
    processing = true;
    emit("processing", { active: true });
    try {
      let count: number;
      do {
        count = await processInbox(harness);
      } while (count > 0);
    } finally {
      processing = false;
      emit("processing", { active: false });
    }
  });

  // Watch outbox and route messages to target agent inboxes
  let routing = false;
  await processOutbox();
  const outboxWatcher = watch(OUTBOX_DIR, async (_eventType: string, filename: string | null) => {
    if ((!filename?.endsWith(".yaml") && !filename?.endsWith(".yml")) || routing) return;
    routing = true;
    try {
      let count: number;
      do {
        count = await processOutbox();
      } while (count > 0);
    } finally {
      routing = false;
    }
  });

  // Watch attachments outbox for agent-created files
  await processAttachmentOutbox(ATTACHMENTS_DIR);
  let processingAttachments = false;
  const attachmentsWatcher = watch(ATTACHMENT_OUTBOX_DIR, async () => {
    if (processingAttachments) return;
    processingAttachments = true;
    try {
      let count: number;
      do {
        count = await processAttachmentOutbox(ATTACHMENTS_DIR);
      } while (count > 0);
    } finally {
      processingAttachments = false;
    }
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive" });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    inboxWatcher.close();
    outboxWatcher.close();
    attachmentsWatcher.close();
    harness.stop();
    emit("shutdown", {});
    process.exit(0);
  });
}

if (import.meta.main) {
  main().catch((err) => {
    emit("error", { message: `Fatal: ${err}` });
    process.exit(1);
  });
}
