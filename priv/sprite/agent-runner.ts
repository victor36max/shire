// agent-runner.ts — Bun daemon that runs recipe scripts, then watches the inbox
// and dispatches to configured harness.
import { watch } from "fs";
import { readFile, readdir, stat, unlink } from "fs/promises";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { createHarness, type Harness, type HarnessType } from "./harness";

const INBOX_DIR = "/workspace/mailbox/inbox";
const OUTBOX_DIR = "/workspace/mailbox/outbox";
const CONFIG_PATH = "/workspace/agent-config.json";
const SHARED_DIR = "/workspace/shared";
const SYNC_MARKER_DIR = "/workspace/.drive-sync";
const MAX_SHARED_FILE_SIZE = 1_000_000; // 1MB limit
const RECIPE_PATH = "/workspace/recipe.json";
const RECIPE_STATE_DIR = "/workspace/.recipe-state";

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

interface RecipeScript {
  name: string;
  run: string;
}

interface Recipe {
  scripts: RecipeScript[];
}

export function emit(type: string, payload: Record<string, unknown> = {}) {
  const line = JSON.stringify({ type, payload });
  process.stdout.write(line + "\n");
}

// ---------------------------------------------------------------------------
// Recipe execution (folded from recipe-runner.ts)
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function getMarkerPath(name: string, hash: string, stateDir = RECIPE_STATE_DIR): string {
  return join(stateDir, `${name}.${hash}`);
}

function hasMarker(name: string, hash: string, stateDir = RECIPE_STATE_DIR): boolean {
  return existsSync(getMarkerPath(name, hash, stateDir));
}

function clearOldMarkers(name: string, currentHash: string, stateDir = RECIPE_STATE_DIR): void {
  if (!existsSync(stateDir)) return;

  for (const file of readdirSync(stateDir)) {
    if (file.startsWith(`${name}.`) && !file.endsWith(`.${currentHash}`)) {
      unlinkSync(join(stateDir, file));
    }
  }
}

function writeMarker(name: string, hash: string, stateDir = RECIPE_STATE_DIR): void {
  writeFileSync(getMarkerPath(name, hash, stateDir), new Date().toISOString());
}

async function runRecipeScript(script: RecipeScript, stateDir = RECIPE_STATE_DIR): Promise<boolean> {
  const hash = hashContent(script.run);

  if (hasMarker(script.name, hash, stateDir)) {
    emit("recipe_step", { name: script.name, status: "skipped" });
    return true;
  }

  clearOldMarkers(script.name, hash, stateDir);

  const proc = Bun.spawn(["bash", "-c", script.run], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/workspace",
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    writeMarker(script.name, hash, stateDir);
    emit("recipe_step", { name: script.name, status: "done" });
    return true;
  } else {
    emit("recipe_step", {
      name: script.name,
      status: "failed",
      exit_code: exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
    return false;
  }
}

export async function runRecipes(
  recipePath = RECIPE_PATH,
  stateDir = RECIPE_STATE_DIR,
): Promise<{ status: string; failed_step?: string }> {
  if (!existsSync(recipePath)) {
    emit("recipe_complete", { status: "no_recipe" });
    return { status: "no_recipe" };
  }

  const recipe: Recipe = JSON.parse(readFileSync(recipePath, "utf-8"));

  if (!recipe.scripts || recipe.scripts.length === 0) {
    emit("recipe_complete", { status: "no_scripts" });
    return { status: "no_scripts" };
  }

  for (const script of recipe.scripts) {
    const success = await runRecipeScript(script, stateDir);
    if (!success) {
      emit("recipe_complete", { status: "failed", failed_step: script.name });
      return { status: "failed", failed_step: script.name };
    }
  }

  emit("recipe_complete", { status: "done", steps: recipe.scripts.length });
  return { status: "done" };
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

export async function loadConfig(path = CONFIG_PATH): Promise<AgentConfig> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
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

export async function processOutbox(outboxDir = OUTBOX_DIR): Promise<number> {
  const files = await readdir(outboxDir);
  const sorted = files.filter((f) => f.endsWith(".json")).sort();

  for (const file of sorted) {
    const path = join(outboxDir, file);
    try {
      const raw = await readFile(path, "utf-8");
      const msg = JSON.parse(raw);

      if (typeof msg.to === "string" && typeof msg.text === "string") {
        emit("agent_message", { to_agent: msg.to, text: msg.text });
      } else {
        emit("error", {
          message: `Invalid outbox file ${file}: missing "to" or "text" field`,
        });
      }

      await unlink(path);
    } catch (err) {
      emit("error", { message: `Failed to process outbox ${file}: ${err}` });
      try {
        await unlink(path);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return sorted.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Run recipe setup scripts first
  const recipeResult = await runRecipes();
  if (recipeResult.status === "failed") {
    process.exit(1);
  }

  const config = await loadConfig();
  const harness = createHarness(config.harness);

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

  // Watch for outbox messages (agent-to-agent)
  let outboxProcessing = false;
  const outboxWatcher = watch(OUTBOX_DIR, async (_eventType: string, filename: string | null) => {
    if (!filename?.endsWith(".json") || outboxProcessing) return;
    outboxProcessing = true;
    try {
      let count: number;
      do {
        count = await processOutbox();
      } while (count > 0);
    } finally {
      outboxProcessing = false;
    }
  });

  // Watch shared drive for file changes (agent -> drive sync)
  const pendingSharedWrites = new Map<string, Timer>();

  const sharedWatcher = watch(SHARED_DIR, { recursive: true }, (_event: string, filename: string | null) => {
    if (!filename) return;

    // Check for sync marker (incoming sync from another agent, not a local write)
    const markerPath = join(SYNC_MARKER_DIR, filename);
    readFile(markerPath)
      .then(() => {
        // Marker exists — this is an incoming sync, consume marker and skip
        return unlink(markerPath);
      })
      .catch(() => {
        // No marker — this is a local agent write, debounce and emit
        const existing = pendingSharedWrites.get(filename);
        if (existing) clearTimeout(existing);

        pendingSharedWrites.set(
          filename,
          setTimeout(async () => {
            pendingSharedWrites.delete(filename);
            const filePath = join(SHARED_DIR, filename);
            try {
              const fileStat = await stat(filePath);
              if (fileStat.size > MAX_SHARED_FILE_SIZE) {
                emit("drive_error", {
                  path: filename,
                  message: `File exceeds ${MAX_SHARED_FILE_SIZE} byte limit`,
                });
                return;
              }
              const content = await readFile(filePath);
              emit("drive_write", {
                path: filename,
                content: content.toString("base64"),
              });
            } catch {
              // File was deleted or unreadable
              emit("drive_delete", { path: filename });
            }
          }, 300),
        );
      });
  });

  // Heartbeat every 30 seconds
  setInterval(() => {
    emit("heartbeat", { status: "alive" });
  }, 30_000);

  // Keep process alive
  process.on("SIGTERM", () => {
    watcher.close();
    outboxWatcher.close();
    sharedWatcher.close();
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
