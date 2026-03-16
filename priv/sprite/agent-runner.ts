// agent-runner.ts — Bun daemon that watches the inbox and dispatches to configured harness.
import { watch } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import { createHarness, type Harness } from "./harness";

const INBOX_DIR = "/workspace/mailbox/inbox";
const CONFIG_PATH = "/workspace/agent-config.json";

export interface AgentConfig {
  harness: string;
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
  harness: Harness,
  config: AgentConfig,
  envelope: MessageEnvelope,
  loadConfigFn: () => Promise<AgentConfig> = loadConfig,
): Promise<{ harness: Harness; config: AgentConfig }> {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
    const text = envelope.payload.text as string;
    const from = envelope.type === "agent_message" ? envelope.from : undefined;
    await harness.sendMessage(text, from);
  } else if (envelope.type === "interrupt") {
    await harness.interrupt();
    emit("interrupted", {});
  } else if (envelope.type === "shutdown") {
    await harness.stop();
    emit("shutdown", {});
    process.exit(0);
  } else if (envelope.type === "configure") {
    await harness.stop();
    const newConfig = await loadConfigFn();
    Object.assign(config, newConfig);
    const newHarness = createHarness(config.harness);
    newHarness.onEvent((event) => emit(event.type, event.payload));
    await newHarness.start({
      model: config.model,
      systemPrompt: config.system_prompt,
      cwd: "/workspace",
      maxTokens: config.max_tokens,
    });
    emit("configured", { model: config.model });
    return { harness: newHarness, config };
  }

  return { harness, config };
}

export async function processInbox(
  harness: Harness,
  config: AgentConfig,
): Promise<{ harness: Harness; config: AgentConfig }> {
  const files = await readdir(INBOX_DIR);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  let currentHarness = harness;
  let currentConfig = config;

  for (const file of sorted) {
    const path = join(INBOX_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope: MessageEnvelope = JSON.parse(raw);
      const result = await processMessage(currentHarness, currentConfig, envelope);
      currentHarness = result.harness;
      currentConfig = result.config;
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
    }
  }

  return { harness: currentHarness, config: currentConfig };
}

async function main() {
  const config = await loadConfig();
  let harness = createHarness(config.harness);

  harness.onEvent((event) => emit(event.type, event.payload));
  await harness.start({
    model: config.model,
    systemPrompt: config.system_prompt,
    cwd: "/workspace",
    maxTokens: config.max_tokens,
  });

  emit("ready", { model: config.model, harness: config.harness });

  let processing = false;

  // Process any existing inbox messages
  const result = await processInbox(harness, config);
  harness = result.harness;

  // Watch for new messages
  const watcher = watch(INBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".json") || processing) return;
    processing = true;
    try {
      const result = await processInbox(harness, config);
      harness = result.harness;
    } finally {
      processing = false;
    }
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive" });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    watcher.close();
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
