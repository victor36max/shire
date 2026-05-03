import { watch, statSync, type FSWatcher } from "fs";
import { bus, type SharedDriveBusEvent } from "../events";
import { safePath } from "./shared-drive-paths";
import * as workspace from "./workspace";

const TOPIC_PREFIX = "shared-drive:";
const DEBOUNCE_MS = 300;

interface Entry {
  watcher: FSWatcher | null;
  refCount: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  pendingPath: string | null;
}

const entries = new Map<string, Entry>();

interface ParsedTopic {
  projectId: string;
  sharedRelPath: string;
}

function parseTopic(topic: string): ParsedTopic | null {
  if (!topic.startsWith(TOPIC_PREFIX)) return null;
  const rest = topic.slice(TOPIC_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx <= 0) return null;
  const projectId = rest.slice(0, colonIdx);
  const sharedRelPath = rest.slice(colonIdx + 1);
  if (!sharedRelPath) return null;
  return { projectId, sharedRelPath };
}

function buildEmitPath(
  sharedRelPath: string,
  filename: string | null,
  isDirWatch: boolean,
): string | null {
  if (!isDirWatch) return normalizeRelPath(sharedRelPath);
  if (!filename) return null;
  const base = sharedRelPath.endsWith("/") ? sharedRelPath : sharedRelPath + "/";
  return normalizeRelPath(base + filename.replace(/\\/g, "/"));
}

function normalizeRelPath(p: string): string {
  let out = p.replace(/\/+/g, "/");
  if (!out.startsWith("/")) out = "/" + out;
  return out;
}

function scheduleEmit(topic: string, path: string): void {
  const entry = entries.get(topic);
  if (!entry) return;
  entry.pendingPath = path;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    const finalPath = entry.pendingPath;
    entry.pendingPath = null;
    if (finalPath == null) return;
    bus.emit<SharedDriveBusEvent>(topic, {
      type: "file_changed",
      payload: { path: finalPath },
    });
  }, DEBOUNCE_MS);
}

/**
 * Start watching the path encoded in a `shared-drive:{projectId}:{path}` topic
 * (or bump the refcount if it's already being watched). Safe to call repeatedly
 * and safe for malformed topics, missing paths, or paths outside the project's
 * shared root — those become no-ops that can still be released.
 */
export function acquireSharedDriveWatch(topic: string): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;

  const existing = entries.get(topic);
  if (existing) {
    existing.refCount += 1;
    return;
  }

  const entry: Entry = {
    watcher: null,
    refCount: 1,
    debounceTimer: null,
    pendingPath: null,
  };
  entries.set(topic, entry);

  const sharedRoot = workspace.sharedDir(parsed.projectId);
  const absPath = safePath(sharedRoot, parsed.sharedRelPath);
  if (!absPath) return;

  let isDir: boolean;
  try {
    isDir = statSync(absPath).isDirectory();
  } catch {
    return;
  }

  try {
    const handler = (_event: string, filename: string | Buffer | null): void => {
      const name = typeof filename === "string" ? filename : (filename?.toString("utf-8") ?? null);
      const path = buildEmitPath(parsed.sharedRelPath, name, isDir);
      if (path) scheduleEmit(topic, path);
    };
    const watcher = isDir ? watch(absPath, { recursive: false }, handler) : watch(absPath, handler);
    watcher.on("error", () => {
      // fs.watch can error when the watched path is removed; swallow so the
      // process stays up. The next acquire will re-stat and re-watch.
    });
    entry.watcher = watcher;
  } catch {
    // Failed to set up the watcher (e.g. path was deleted between stat and
    // watch). Leave the entry intact so refcount/release still balance.
  }
}

/**
 * Release one reference to a `shared-drive:{projectId}:{path}` topic. When the
 * last reference is released the underlying `FSWatcher` (if any) is closed.
 * Safe to call with topics that were never acquired.
 */
export function releaseSharedDriveWatch(topic: string): void {
  const entry = entries.get(topic);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed.
    }
  }
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entries.delete(topic);
}
