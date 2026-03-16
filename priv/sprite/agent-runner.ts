// agent-runner.ts — Bun daemon that watches the inbox and dispatches to AI backend.
import { watch } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";

const INBOX_DIR = "/workspace/mailbox/inbox";
const CONFIG_PATH = "/workspace/agent-config.json";

export interface AgentConfig {
  model: string;
  system_prompt: string;
  max_tokens?: number;
}

export interface MessageEnvelope {
  seq: number;
  ts: number;
  type: string;
  from: string;
  payload: Record<string, unknown>;
}

export function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
}

export async function loadConfig(path = CONFIG_PATH): Promise<AgentConfig> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

export async function processMessage(
  client: Anthropic,
  config: AgentConfig,
  messages: Anthropic.MessageParam[],
  envelope: MessageEnvelope,
  loadConfigFn: () => Promise<AgentConfig> = loadConfig
) {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
    const text = envelope.payload.text as string;
    const prefix =
      envelope.type === "agent_message"
        ? `[Message from agent "${envelope.from}"]\n${text}`
        : text;

    messages.push({ role: "user", content: prefix });

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.max_tokens ?? 4096,
        system: config.system_prompt,
        messages,
      });

      stream.on("text", (delta) => {
        emit("text_delta", { delta });
      });

      const finalMessage = await stream.finalMessage();
      const fullText = finalMessage.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      messages.push({ role: "assistant", content: fullText });
      emit("text", { text: fullText });
      emit("turn_complete", {});
    } catch (err) {
      emit("error", { message: String(err) });
    }
  } else if (envelope.type === "interrupt") {
    // TODO: Cancel active streaming request (AbortController) when implemented
    messages.length = 0; // Clear conversation history
    emit("interrupted", {});
  } else if (envelope.type === "shutdown") {
    emit("shutdown", {});
    process.exit(0);
  } else if (envelope.type === "configure") {
    // Hot-reload: re-read config file and apply new settings
    const newConfig = await loadConfigFn();
    Object.assign(config, newConfig);
    emit("configured", { model: config.model });
  }
}

export async function processInbox(
  client: Anthropic,
  config: AgentConfig,
  messages: Anthropic.MessageParam[]
) {
  const files = await readdir(INBOX_DIR);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  for (const file of sorted) {
    const path = join(INBOX_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope: MessageEnvelope = JSON.parse(raw);
      await processMessage(client, config, messages, envelope);
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
    }
  }
}

async function main() {
  const config = await loadConfig();
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [];
  let processing = false;

  emit("ready", { model: config.model });

  // Process any existing inbox messages
  await processInbox(client, config, messages);

  // Watch for new messages
  const watcher = watch(INBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".json") || processing) return;
    processing = true;
    try {
      await processInbox(client, config, messages);
    } finally {
      processing = false;
    }
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive", message_count: messages.length });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    watcher.close();
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
