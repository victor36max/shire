import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createTestDb } from "../test/setup";
import { createApp } from "../server";
import { ProjectManager } from "../runtime/project-manager";
import { Scheduler } from "../runtime/scheduler";
import { isNewer, CURRENT_VERSION, resetVersionCache } from "./version";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  createTestDb();
  const projectManager = new ProjectManager();
  const scheduler = new Scheduler(projectManager);
  app = createApp({ projectManager, scheduler });
  resetVersionCache();
});

async function request(method: string, path: string) {
  return app.request(path, { method, headers: { "Content-Type": "application/json" } });
}

describe("isNewer", () => {
  it("detects newer major version", () => {
    expect(isNewer("2.0.0", "1.0.0")).toBe(true);
  });

  it("detects newer minor version", () => {
    expect(isNewer("1.1.0", "1.0.0")).toBe(true);
  });

  it("detects newer patch version", () => {
    expect(isNewer("1.0.1", "1.0.0")).toBe(true);
  });

  it("returns false for same version", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns false for older version", () => {
    expect(isNewer("1.0.0", "1.0.1")).toBe(false);
  });

  it("handles different length versions", () => {
    expect(isNewer("1.0.1", "1.0")).toBe(true);
    expect(isNewer("1.0", "1.0.1")).toBe(false);
  });

  it("returns false when current is a pre-release version", () => {
    expect(isNewer("1.0.0", "0.1.0-dev")).toBe(false);
    expect(isNewer("99.0.0", "1.0.0-alpha")).toBe(false);
  });
});

describe("GET /api/version", () => {
  it("returns current version and latest from registry", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 })),
    ) as unknown as typeof fetch;

    try {
      const res = await request("GET", "/api/version");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        current: string;
        latest: string | null;
        updateAvailable: boolean;
        upgradeCommands: string[];
      };
      expect(data.current).toBe(CURRENT_VERSION);
      expect(data.latest).toBe("99.0.0");
      // Dev versions (containing "-") never report updateAvailable
      expect(data.updateAvailable).toBe(!CURRENT_VERSION.includes("-"));
      expect(data.upgradeCommands).toEqual([
        "npm install -g agents-shire@latest",
        "bun install -g agents-shire@latest",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles npm registry failure gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("network error")),
    ) as unknown as typeof fetch;

    try {
      const res = await request("GET", "/api/version");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        current: string;
        latest: string | null;
        updateAvailable: boolean;
      };
      expect(data.current).toBe(CURRENT_VERSION);
      expect(data.latest).toBeNull();
      expect(data.updateAvailable).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns updateAvailable false when versions match", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ version: CURRENT_VERSION }), { status: 200 })),
    ) as unknown as typeof fetch;

    try {
      const res = await request("GET", "/api/version");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { updateAvailable: boolean };
      expect(data.updateAvailable).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
