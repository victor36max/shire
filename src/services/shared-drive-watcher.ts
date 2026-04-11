import { watch, type FSWatcher } from "fs";
import { mkdir } from "fs/promises";
import { relative } from "path";
import { bus, type SharedDriveBusEvent } from "../events";
import * as workspace from "./workspace";

const watchers = new Map<string, FSWatcher>();

/** Tracks projects where stop was called while mkdir was still in-flight. */
const stoppedProjects = new Set<string>();

/** Debounce timers keyed by `${projectId}:${relativePath}`. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 300;

export function startSharedDriveWatcher(projectId: string): void {
  if (watchers.has(projectId)) return;
  stoppedProjects.delete(projectId);

  const sharedRoot = workspace.sharedDir(projectId);

  // Ensure the directory exists before watching
  mkdir(sharedRoot, { recursive: true })
    .then(() => {
      // Guard against stop being called before mkdir resolves
      if (watchers.has(projectId) || stoppedProjects.has(projectId)) {
        stoppedProjects.delete(projectId);
        return;
      }

      const watcher = watch(sharedRoot, { recursive: true }, (_event, filename) => {
        if (!filename) return;

        // Normalize to forward-slash relative path with leading /
        const rel = "/" + relative(sharedRoot, `${sharedRoot}/${filename}`).replace(/\\/g, "/");
        const key = `${projectId}:${rel}`;

        const existing = debounceTimers.get(key);
        if (existing) clearTimeout(existing);

        debounceTimers.set(
          key,
          setTimeout(() => {
            debounceTimers.delete(key);
            bus.emit<SharedDriveBusEvent>(`project:${projectId}:shared-drive`, {
              type: "file_changed",
              payload: { path: rel },
            });
          }, DEBOUNCE_MS),
        );
      });

      watchers.set(projectId, watcher);
    })
    .catch((err) => {
      console.error(`Failed to start shared drive watcher for project ${projectId}:`, err);
    });
}

export function stopSharedDriveWatcher(projectId: string): void {
  stoppedProjects.add(projectId);
  const watcher = watchers.get(projectId);
  if (watcher) {
    watcher.close();
    watchers.delete(projectId);
  }

  // Clean up any pending debounce timers for this project
  for (const [key, timer] of debounceTimers) {
    if (key.startsWith(`${projectId}:`)) {
      clearTimeout(timer);
      debounceTimers.delete(key);
    }
  }
}
