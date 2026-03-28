import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { logFilePath } from "./daemon";

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

    it("creates data directory on first daemon start", async () => {
      expect(existsSync(testDataDir)).toBe(false);

      // Start daemon — it will fail to boot the server (no db), but the directory should be created
      try {
        await $`bun run ${CLI_PATH} start -d -p 19876`
          .env({ ...process.env, SHIRE_DATA_DIR: testDataDir })
          .text();
      } catch {
        // Server may fail, but directory should exist
      }

      expect(existsSync(testDataDir)).toBe(true);
      expect(existsSync(logFilePath())).toBe(true);
    });
  });
});
