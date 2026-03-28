import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { logFilePath } from "./daemon";
import { openBrowser, shouldOpenBrowser } from "./cli";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

describe("CLI", () => {
  it("prints help with --help", async () => {
    const result = await $`bun run ${CLI_PATH} --help`.text();
    expect(result).toContain("shire v");
    expect(result).toContain("Usage:");
    expect(result).toContain("start");
    expect(result).toContain("stop");
    expect(result).toContain("status");
    expect(result).toContain("--port");
    expect(result).toContain("--daemon");
    expect(result).toContain("--no-open");
  });

  it("prints version with --version", async () => {
    const result = await $`bun run ${CLI_PATH} --version`.text();
    expect(result.trim()).toMatch(/^shire v\d+\.\d+\.\d+$/);
  });

  it("exits with error for unknown argument", async () => {
    try {
      await $`bun run ${CLI_PATH} --bogus`.text();
      expect(true).toBe(false); // Should not reach here
    } catch {
      // Expected to fail with non-zero exit code
    }
  });

  describe("openBrowser", () => {
    it("spawns the platform-specific open command", () => {
      const saved: Record<string, string | undefined> = {};
      const keys = ["SHIRE_NO_OPEN", "SSH_CLIENT", "SSH_TTY"];
      for (const k of keys) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
      // Ensure DISPLAY is set on Linux so shouldOpenBrowser() returns true
      if (process.platform === "linux") {
        saved.DISPLAY = process.env.DISPLAY;
        process.env.DISPLAY = ":0";
      }
      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({} as ReturnType<typeof Bun.spawn>);
      try {
        openBrowser("http://localhost:8080");
        expect(spawnSpy).toHaveBeenCalledTimes(1);
        const args = spawnSpy.mock.calls[0][0] as string[];
        const expectedCmd = process.platform === "darwin" ? "open" : "xdg-open";
        expect(args).toEqual([expectedCmd, "http://localhost:8080"]);
      } finally {
        spawnSpy.mockRestore();
        for (const k of [...keys, "DISPLAY"]) {
          if (saved[k] !== undefined) process.env[k] = saved[k];
          else delete process.env[k];
        }
      }
    });

    it("skips opening when SHIRE_NO_OPEN is set", () => {
      process.env.SHIRE_NO_OPEN = "1";
      const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({} as ReturnType<typeof Bun.spawn>);
      try {
        openBrowser("http://localhost:8080");
        expect(spawnSpy).not.toHaveBeenCalled();
      } finally {
        spawnSpy.mockRestore();
        delete process.env.SHIRE_NO_OPEN;
      }
    });

    it("skips opening in SSH sessions", () => {
      const prev = process.env.SSH_CLIENT;
      process.env.SSH_CLIENT = "192.168.1.1 12345 22";
      try {
        expect(shouldOpenBrowser()).toBe(false);
      } finally {
        if (prev !== undefined) process.env.SSH_CLIENT = prev;
        else delete process.env.SSH_CLIENT;
      }
    });

    it("does not throw when spawn fails", () => {
      const prev = process.env.SHIRE_NO_OPEN;
      delete process.env.SHIRE_NO_OPEN;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn failed");
      });
      try {
        expect(() => openBrowser("http://localhost:8080")).not.toThrow();
      } finally {
        spawnSpy.mockRestore();
        if (prev !== undefined) process.env.SHIRE_NO_OPEN = prev;
      }
    });
  });

  describe("daemon mode", () => {
    const testDataDir = join(tmpdir(), `shire-cli-test-${process.pid}`);

    beforeEach(() => {
      process.env.SHIRE_DATA_DIR = testDataDir;
      rmSync(testDataDir, { recursive: true, force: true });
    });

    afterEach(() => {
      // Stop any daemon we started
      try {
        $`bun run ${CLI_PATH} stop`.quiet();
      } catch {
        // May not be running
      }
      delete process.env.SHIRE_DATA_DIR;
      rmSync(testDataDir, { recursive: true, force: true });
    });

    it("daemon output includes clickable URL and creates data directory", async () => {
      expect(existsSync(testDataDir)).toBe(false);

      const result = await $`bun run ${CLI_PATH} start -d -p 19876`
        .env({ ...process.env, SHIRE_DATA_DIR: testDataDir, SHIRE_NO_OPEN: "1" })
        .text();

      expect(result).toContain("http://localhost:19876");
      expect(result).toContain("URL:");
      expect(existsSync(testDataDir)).toBe(true);
      expect(existsSync(logFilePath())).toBe(true);
    });
  });
});
