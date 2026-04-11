import { describe, it, expect, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { bus, type SharedDriveBusEvent } from "../events";
import { startSharedDriveWatcher, stopSharedDriveWatcher } from "./shared-drive-watcher";
import * as workspace from "./workspace";

const TEST_PROJECT_ID = "watcher-test-project";

async function ensureSharedDir(): Promise<string> {
  const dir = workspace.sharedDir(TEST_PROJECT_ID);
  await mkdir(dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  stopSharedDriveWatcher(TEST_PROJECT_ID);
  const dir = workspace.sharedDir(TEST_PROJECT_ID);
  await rm(dir, { recursive: true, force: true });
});

describe("shared-drive-watcher", () => {
  it("emits file_changed event when a file is written", async () => {
    const sharedDir = await ensureSharedDir();
    startSharedDriveWatcher(TEST_PROJECT_ID);

    // Give the watcher time to initialize
    await new Promise((r) => setTimeout(r, 200));

    const events: SharedDriveBusEvent[] = [];
    const unsub = bus.on<SharedDriveBusEvent>(
      `project:${TEST_PROJECT_ID}:shared-drive`,
      (event) => {
        events.push(event);
      },
    );

    // Write a file
    await writeFile(join(sharedDir, "test.md"), "hello world", "utf-8");

    // Wait for debounce + some buffer
    await new Promise((r) => setTimeout(r, 600));

    unsub();

    expect(events.length).toBeGreaterThanOrEqual(1);
    const fileChangedEvents = events.filter((e) => e.type === "file_changed");
    expect(fileChangedEvents.length).toBeGreaterThanOrEqual(1);
    expect(fileChangedEvents[0].payload.path).toBe("/test.md");
  });

  it("emits event for files in subdirectories", async () => {
    const sharedDir = await ensureSharedDir();
    const subDir = join(sharedDir, "docs");
    await mkdir(subDir, { recursive: true });

    startSharedDriveWatcher(TEST_PROJECT_ID);
    await new Promise((r) => setTimeout(r, 200));

    const events: SharedDriveBusEvent[] = [];
    const unsub = bus.on<SharedDriveBusEvent>(
      `project:${TEST_PROJECT_ID}:shared-drive`,
      (event) => {
        events.push(event);
      },
    );

    await writeFile(join(subDir, "nested.txt"), "nested content", "utf-8");
    await new Promise((r) => setTimeout(r, 600));

    unsub();

    const fileChangedEvents = events.filter((e) => e.type === "file_changed");
    expect(fileChangedEvents.length).toBeGreaterThanOrEqual(1);
    expect(fileChangedEvents.some((e) => e.payload.path === "/docs/nested.txt")).toBe(true);
  });

  it("stopSharedDriveWatcher stops emitting events", async () => {
    const sharedDir = await ensureSharedDir();
    startSharedDriveWatcher(TEST_PROJECT_ID);
    await new Promise((r) => setTimeout(r, 200));

    stopSharedDriveWatcher(TEST_PROJECT_ID);

    const events: SharedDriveBusEvent[] = [];
    const unsub = bus.on<SharedDriveBusEvent>(
      `project:${TEST_PROJECT_ID}:shared-drive`,
      (event) => {
        events.push(event);
      },
    );

    await writeFile(join(sharedDir, "after-stop.md"), "ignored", "utf-8");
    await new Promise((r) => setTimeout(r, 600));

    unsub();

    expect(events.length).toBe(0);
  });

  it("does not crash when starting watcher for same project twice", async () => {
    await ensureSharedDir();
    startSharedDriveWatcher(TEST_PROJECT_ID);
    await new Promise((r) => setTimeout(r, 200));

    // Second call should be a no-op
    startSharedDriveWatcher(TEST_PROJECT_ID);
    await new Promise((r) => setTimeout(r, 200));

    // Should still be functional — just verify no exception was thrown
    stopSharedDriveWatcher(TEST_PROJECT_ID);
  });
});
