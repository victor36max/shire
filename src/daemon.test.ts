import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  writePortFile,
  readPortFile,
  removePortFile,
  isProcessRunning,
  pidFileExists,
} from "./daemon";

// Use a temp directory to avoid touching real ~/.shire/
const TEST_DATA_DIR = join(tmpdir(), `shire-daemon-test-${process.pid}`);

describe("daemon utilities", () => {
  beforeEach(() => {
    process.env.SHIRE_DATA_DIR = TEST_DATA_DIR;
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SHIRE_DATA_DIR;
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe("PID file", () => {
    it("writes and reads a PID", () => {
      writePidFile(12345);
      expect(readPidFile()).toBe(12345);
    });

    it("returns null when no PID file exists", () => {
      expect(readPidFile()).toBeNull();
    });

    it("removes PID file", () => {
      writePidFile(12345);
      removePidFile();
      expect(readPidFile()).toBeNull();
    });

    it("removePidFile does not throw when file is missing", () => {
      expect(() => removePidFile()).not.toThrow();
    });

    it("pidFileExists returns correct state", () => {
      expect(pidFileExists()).toBe(false);
      writePidFile(12345);
      expect(pidFileExists()).toBe(true);
    });
  });

  describe("port file", () => {
    it("writes and reads a port", () => {
      writePortFile(8080);
      expect(readPortFile()).toBe(8080);
    });

    it("returns null when no port file exists", () => {
      expect(readPortFile()).toBeNull();
    });

    it("removes port file", () => {
      writePortFile(8080);
      removePortFile();
      expect(readPortFile()).toBeNull();
    });
  });

  describe("isProcessRunning", () => {
    it("returns true for the current process", () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    it("returns false for a non-existent PID", () => {
      // PID 99999999 is very unlikely to exist
      expect(isProcessRunning(99999999)).toBe(false);
    });
  });
});
