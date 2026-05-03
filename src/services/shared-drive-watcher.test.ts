import { describe, it, expect, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { bus, type SharedDriveBusEvent } from "../events";
import { acquireSharedDriveWatch, releaseSharedDriveWatch } from "./shared-drive-watcher";
import * as workspace from "./workspace";

const DEBOUNCE_BUFFER_MS = 600; // 300ms debounce + slack

let projectCounter = 0;
function nextProject(): { id: string; sharedDir: string } {
  projectCounter += 1;
  const id = `watcher-test-${Date.now()}-${projectCounter}`;
  return { id, sharedDir: workspace.sharedDir(id) };
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function trackProject(id: string): void {
  cleanups.push(async () => {
    await rm(workspace.root(id), { recursive: true, force: true }).catch(() => {});
  });
}

function collect(topic: string): {
  events: SharedDriveBusEvent[];
  unsub: () => void;
} {
  const events: SharedDriveBusEvent[] = [];
  const unsub = bus.on<SharedDriveBusEvent>(topic, (event) => {
    events.push(event);
  });
  return { events, unsub };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("shared-drive-watcher", () => {
  it("emits file_changed when an acquired file is modified", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    await mkdir(sharedDir, { recursive: true });
    const filePath = join(sharedDir, "note.md");
    await writeFile(filePath, "hello", "utf-8");

    const topic = `shared-drive:${id}:/note.md`;
    acquireSharedDriveWatch(topic);
    cleanups.push(() => releaseSharedDriveWatch(topic));
    await wait(100);

    const { events, unsub } = collect(topic);
    cleanups.push(unsub);

    await writeFile(filePath, "world", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    const fileChanged = events.filter((e) => e.type === "file_changed");
    expect(fileChanged.length).toBeGreaterThanOrEqual(1);
    expect(fileChanged[0].payload.path).toBe("/note.md");
  });

  it("emits file_changed when a child of an acquired directory changes", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    const subDir = join(sharedDir, "docs");
    await mkdir(subDir, { recursive: true });

    const topic = `shared-drive:${id}:/docs`;
    acquireSharedDriveWatch(topic);
    cleanups.push(() => releaseSharedDriveWatch(topic));
    await wait(100);

    const { events, unsub } = collect(topic);
    cleanups.push(unsub);

    await writeFile(join(subDir, "inside.txt"), "nested", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    const fileChanged = events.filter((e) => e.type === "file_changed");
    expect(fileChanged.length).toBeGreaterThanOrEqual(1);
    expect(fileChanged.some((e) => e.payload.path === "/docs/inside.txt")).toBe(true);
  });

  it("acquires a missing path without throwing and supports release", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    await mkdir(sharedDir, { recursive: true });

    const topic = `shared-drive:${id}:/missing.md`;
    expect(() => acquireSharedDriveWatch(topic)).not.toThrow();
    await wait(50);
    expect(() => releaseSharedDriveWatch(topic)).not.toThrow();
  });

  it("rejects path traversal and emits no events", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    await mkdir(sharedDir, { recursive: true });

    const topic = `shared-drive:${id}:/../escape.md`;
    acquireSharedDriveWatch(topic);
    cleanups.push(() => releaseSharedDriveWatch(topic));
    await wait(100);

    const { events, unsub } = collect(topic);
    cleanups.push(unsub);

    // Modify a file inside shared (would fire if we accidentally watched root).
    await writeFile(join(sharedDir, "decoy.md"), "x", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    expect(events.filter((e) => e.type === "file_changed").length).toBe(0);
  });

  it("refcounts: shared watcher persists until last release", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    await mkdir(sharedDir, { recursive: true });
    const filePath = join(sharedDir, "shared.md");
    await writeFile(filePath, "a", "utf-8");

    const topic = `shared-drive:${id}:/shared.md`;
    acquireSharedDriveWatch(topic);
    acquireSharedDriveWatch(topic);
    await wait(100);

    // First release should leave the underlying watcher active.
    releaseSharedDriveWatch(topic);

    const { events, unsub } = collect(topic);
    cleanups.push(unsub);

    await writeFile(filePath, "b", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);
    expect(events.filter((e) => e.type === "file_changed").length).toBeGreaterThanOrEqual(1);

    // Final release should close the watcher; subsequent changes must not emit.
    releaseSharedDriveWatch(topic);

    const beforeCount = events.filter((e) => e.type === "file_changed").length;
    await writeFile(filePath, "c", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);
    const afterCount = events.filter((e) => e.type === "file_changed").length;
    expect(afterCount).toBe(beforeCount);
  });

  it("releaseSharedDriveWatch on an unknown topic is a no-op", () => {
    expect(() => releaseSharedDriveWatch("shared-drive:nope:/never")).not.toThrow();
  });

  it("scopes events to the acquired topic only", async () => {
    const { id, sharedDir } = nextProject();
    trackProject(id);
    await mkdir(sharedDir, { recursive: true });
    const a = join(sharedDir, "a.md");
    const b = join(sharedDir, "b.md");
    await writeFile(a, "a", "utf-8");
    await writeFile(b, "b", "utf-8");

    const topicA = `shared-drive:${id}:/a.md`;
    const topicB = `shared-drive:${id}:/b.md`;
    acquireSharedDriveWatch(topicA);
    acquireSharedDriveWatch(topicB);
    cleanups.push(() => releaseSharedDriveWatch(topicA));
    cleanups.push(() => releaseSharedDriveWatch(topicB));
    await wait(100);

    const a1 = collect(topicA);
    const b1 = collect(topicB);
    cleanups.push(a1.unsub, b1.unsub);

    await writeFile(a, "a-modified", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    expect(a1.events.filter((e) => e.type === "file_changed").length).toBeGreaterThanOrEqual(1);
    expect(b1.events.filter((e) => e.type === "file_changed").length).toBe(0);
  });

  it("ignores malformed topics", () => {
    expect(() => acquireSharedDriveWatch("not-a-shared-drive-topic")).not.toThrow();
    expect(() => acquireSharedDriveWatch("shared-drive:")).not.toThrow();
    expect(() => releaseSharedDriveWatch("not-a-shared-drive-topic")).not.toThrow();
  });
});
