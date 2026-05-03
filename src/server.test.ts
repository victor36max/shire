import { describe, it, expect, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { handleWsMessage, handleWsClose } from "./server";
import * as workspace from "./services/workspace";

const DEBOUNCE_BUFFER_MS = 600;

interface FakeWs {
  send(data: string): void;
  events: Array<{ topic: string; type: string; payload: { path: string } }>;
}

function makeWs(): FakeWs {
  const events: FakeWs["events"] = [];
  return {
    events,
    send(data: string) {
      const parsed = JSON.parse(data) as {
        topic: string;
        type: string;
        payload: { path: string };
      };
      events.push(parsed);
    },
  };
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("handleWsMessage / handleWsClose — shared-drive integration", () => {
  it("activates the watcher on subscribe and forwards file_changed to the ws", async () => {
    const id = `ws-test-${Date.now()}-1`;
    const sharedDir = workspace.sharedDir(id);
    await mkdir(sharedDir, { recursive: true });
    cleanups.push(() => rm(workspace.root(id), { recursive: true, force: true }));

    const filePath = join(sharedDir, "note.md");
    await writeFile(filePath, "v1", "utf-8");

    const ws = makeWs();
    const topic = `shared-drive:${id}:/note.md`;
    handleWsMessage(ws, JSON.stringify({ type: "subscribe", topic }));
    cleanups.push(() => handleWsClose(ws));
    await wait(100);

    await writeFile(filePath, "v2", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    const fileEvents = ws.events.filter((e) => e.type === "file_changed");
    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    expect(fileEvents[0].topic).toBe(topic);
    expect(fileEvents[0].payload.path).toBe("/note.md");
  });

  it("releases the watcher on unsubscribe so further changes do not emit", async () => {
    const id = `ws-test-${Date.now()}-2`;
    const sharedDir = workspace.sharedDir(id);
    await mkdir(sharedDir, { recursive: true });
    cleanups.push(() => rm(workspace.root(id), { recursive: true, force: true }));

    const filePath = join(sharedDir, "note.md");
    await writeFile(filePath, "v1", "utf-8");

    const ws = makeWs();
    const topic = `shared-drive:${id}:/note.md`;
    handleWsMessage(ws, JSON.stringify({ type: "subscribe", topic }));
    await wait(100);

    handleWsMessage(ws, JSON.stringify({ type: "unsubscribe", topic }));

    await writeFile(filePath, "v2", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    expect(ws.events.filter((e) => e.type === "file_changed").length).toBe(0);
  });

  it("releases the watcher on ws close", async () => {
    const id = `ws-test-${Date.now()}-3`;
    const sharedDir = workspace.sharedDir(id);
    await mkdir(sharedDir, { recursive: true });
    cleanups.push(() => rm(workspace.root(id), { recursive: true, force: true }));

    const filePath = join(sharedDir, "note.md");
    await writeFile(filePath, "v1", "utf-8");

    const ws = makeWs();
    const topic = `shared-drive:${id}:/note.md`;
    handleWsMessage(ws, JSON.stringify({ type: "subscribe", topic }));
    await wait(100);

    handleWsClose(ws);

    await writeFile(filePath, "v2", "utf-8");
    await wait(DEBOUNCE_BUFFER_MS);

    expect(ws.events.filter((e) => e.type === "file_changed").length).toBe(0);
  });
});
