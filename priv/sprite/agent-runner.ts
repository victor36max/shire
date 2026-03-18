// agent-runner.ts — Bun daemon that watches the inbox and dispatches to configured harness.
// Each agent runs in its own workspace directory under /workspace/agents/{name}/.
import { watch } from "fs";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
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
const RECIPE_PATH = join(AGENT_DIR, "recipe.yaml");

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

export function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
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

export async function processMessage(harness: Harness, envelope: MessageEnvelope): Promise<void> {
  if (envelope.type === "user_message" || envelope.type === "agent_message") {
    const text = envelope.payload.text as string;
    const from = envelope.type === "agent_message" ? envelope.from : undefined;
    await harness.sendMessage(text, from);
  } else if (envelope.type === "interrupt") {
    await harness.interrupt();
    emit("interrupted", {});
  }
}

export async function processInbox(harness: Harness, inboxDir = INBOX_DIR): Promise<number> {
  const files = await readdir(inboxDir);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  for (const file of sorted) {
    const path = join(inboxDir, file);
    try {
      const raw = await readFile(path, "utf-8");
      const envelope: MessageEnvelope = JSON.parse(raw);
      await processMessage(harness, envelope);
      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process ${file}: ${err}` });
    }
  }

  return sorted.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = await loadConfig();
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

  // Watch for new messages
  const watcher = watch(INBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".json") || processing) return;
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
